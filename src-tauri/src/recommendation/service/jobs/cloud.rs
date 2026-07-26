use super::*;
use crate::recommendation::service::{
    candidates::merge_discovery_candidates, storage::save_cloud_recommendation_result,
};

/// 总时限保底值，维持既有 55 秒行为。
const CLOUD_JOB_MIN_TIMEOUT_MS: u64 = 55_000;
/// 管道内串行的 LLM 阶段数：discovery plan 与 cloud rerank。
const LLM_STAGES: u64 = 2;
/// 每个阶段最多请求两次：json_object 失败后回退普通模式重试一次
/// （见 `llm::request_json_with_fallback`）。
const LLM_ATTEMPTS_PER_STAGE: u64 = 2;
/// 平台搜索与本地计算的额外预算。
const PLATFORM_SEARCH_BUDGET_MS: u64 = 25_000;

/// 总时限由单请求超时推导：`llm_config.timeout_ms` 允许配置到 60 秒
/// （见 `llm_config::config_from_input` 的 clamp），固定 55 秒总时限会在
/// 单请求超时较大时把任务"冤杀"。这里保证总时限始终覆盖最坏情况下的
/// 全部串行 LLM 请求（2 阶段 × 2 次尝试）加平台搜索预算。
pub(crate) fn cloud_job_timeout_ms(per_request_timeout_ms: u64) -> u64 {
    let llm_budget = per_request_timeout_ms.saturating_mul(LLM_STAGES * LLM_ATTEMPTS_PER_STAGE);
    CLOUD_JOB_MIN_TIMEOUT_MS.max(llm_budget.saturating_add(PLATFORM_SEARCH_BUDGET_MS))
}

/// Wraps an await point with the job cancellation signal (contract §7.8).
/// Returns `None` when cancelled; dropping `future` aborts any in-flight
/// reqwest request so no tokens keep burning.
pub(crate) async fn with_cancellation<F>(
    cancel_rx: &mut watch::Receiver<bool>,
    future: F,
) -> Option<F::Output>
where
    F: std::future::Future,
{
    if *cancel_rx.borrow() {
        return None;
    }
    tokio::select! {
        biased;
        _ = cancel_rx.changed() => None,
        result = future => Some(result),
    }
}

fn cancelled_error() -> CommandError {
    CommandError::cancelled("推荐任务已被新的播放行为取代")
}

pub(super) struct CloudJobTask {
    pub(super) conn: Arc<Mutex<Connection>>,
    pub(super) app: tauri::AppHandle,
    pub(super) provider: OpenAiCompatibleProvider,
    pub(super) client: reqwest::Client,
    pub(super) jobs: Arc<Mutex<HashMap<String, RecommendationJob>>>,
    pub(super) last_llm_error: Arc<Mutex<Option<String>>>,
    pub(super) generation_state: Arc<AtomicU64>,
    pub(super) generation: u64,
    pub(super) job_id: String,
    pub(super) query: RecommendationQuery,
    pub(super) local: Vec<RecommendationItem>,
    pub(super) request_id: String,
    pub(super) context: String,
    pub(super) candidate_window: usize,
    pub(super) total_timeout_ms: u64,
    pub(super) fallback_items: Vec<RecommendationItem>,
}

impl CloudJobTask {
    fn is_current(&self) -> bool {
        self.generation_state.load(Ordering::SeqCst) == self.generation
    }

    fn fail(&self, detail: &str, error: String, items: Vec<RecommendationItem>) {
        if !self.is_current() {
            return;
        }
        *self.last_llm_error.lock() = Some(error.clone());
        update_recommendation_job(
            &self.app,
            &self.jobs,
            &self.job_id,
            JobTransition {
                status: RecommendationJobStatus::Error,
                stage: RecommendationJobStage::Error,
                detail: detail.to_string(),
                items: Some(items),
                error: Some(error),
            },
        );
    }
}

pub(super) async fn run_cloud_job(task: CloudJobTask, mut cancel_rx: watch::Receiver<bool>) {
    let deadline = std::time::Duration::from_millis(task.total_timeout_ms);
    match tokio::time::timeout(deadline, execute_cloud_job(&task, &mut cancel_rx)).await {
        Ok(Ok(())) => {}
        Ok(Err(cancelled)) => log::info!("云端推荐任务已中止: {}", cancelled),
        Err(_) => task.fail(
            "云端推荐处理超时，保留最近一次可用结果",
            "云端推荐任务超过总时限".to_string(),
            task.fallback_items.clone(),
        ),
    }
}

async fn execute_cloud_job(
    task: &CloudJobTask,
    cancel_rx: &mut watch::Receiver<bool>,
) -> CommandResult<()> {
    let Some((discovered, plan_error)) = plan_and_discover(task, cancel_rx).await? else {
        return Ok(());
    };
    let merged = filter_merged_candidates(task, discovered);
    if merged.is_empty() {
        let error = plan_error.unwrap_or_else(|| "平台搜索未找到可验证的新歌候选".to_string());
        task.fail(
            "没有可用于重排的真实候选，保留最近一次云端结果",
            error,
            task.fallback_items.clone(),
        );
        return Ok(());
    }
    mark_job_stage(
        &task.app,
        &task.jobs,
        &task.job_id,
        RecommendationJobStage::CloudRerank,
        "云端正在统一重排本地候选和真实新歌候选",
    );
    let rerank = llm::enhance_recommendations(
        Arc::clone(&task.conn),
        &task.provider,
        &task.query,
        merged,
        &task.request_id,
    );
    let result = with_cancellation(cancel_rx, rerank)
        .await
        .ok_or_else(cancelled_error)?;
    if !task.is_current() {
        return Ok(());
    }
    if let Some(error) = result.error {
        let items = if task.fallback_items.is_empty() {
            result.items
        } else {
            task.fallback_items.clone()
        };
        task.fail("云端重排失败，保留最近一次可用结果", error, items);
        return Ok(());
    }
    persist_success(task, result.items);
    Ok(())
}

type DiscoveryOutcome = Option<(Vec<discovery::DiscoveredSong>, Option<String>)>;

async fn plan_and_discover(
    task: &CloudJobTask,
    cancel_rx: &mut watch::Receiver<bool>,
) -> CommandResult<DiscoveryOutcome> {
    mark_job_stage(
        &task.app,
        &task.jobs,
        &task.job_id,
        RecommendationJobStage::DiscoveryPlan,
        "云端正在生成新歌发现方向",
    );
    let plan_future = llm::build_discovery_plan(
        Arc::clone(&task.conn),
        &task.provider,
        &task.query,
        &task.local,
        &task.request_id,
        DISCOVERY_QUERY_LIMIT,
    );
    let plan = with_cancellation(cancel_rx, plan_future)
        .await
        .ok_or_else(cancelled_error)?;
    if !task.is_current() {
        return Ok(None);
    }
    if let Some(error) = &plan.error {
        *task.last_llm_error.lock() = Some(error.clone());
    }
    if plan.queries.is_empty() {
        return Ok(Some((Vec::new(), plan.error)));
    }
    mark_job_stage(
        &task.app,
        &task.jobs,
        &task.job_id,
        RecommendationJobStage::PlatformSearch,
        "正在通过平台搜索验证新歌候选",
    );
    let discover_future = discovery::discover_songs(
        task.client.clone(),
        plan.queries,
        DISCOVERY_RESULTS_PER_SOURCE,
        DISCOVERY_CANDIDATE_LIMIT,
    );
    let discovered = with_cancellation(cancel_rx, discover_future)
        .await
        .ok_or_else(cancelled_error)?;
    Ok(task.is_current().then_some((discovered, plan.error)))
}

fn filter_merged_candidates(
    task: &CloudJobTask,
    discovered: Vec<discovery::DiscoveredSong>,
) -> Vec<RecommendationItem> {
    let merged = merge_discovery_candidates(
        task.local.clone(),
        discovered,
        &task.request_id,
        task.candidate_window,
        task.query.seed.as_ref(),
    );
    let guard = task.conn.lock();
    exclusions::filter_items(&guard, merged).unwrap_or_else(|error| {
        log::warn!("过滤云端推荐候选失败，已丢弃候选: {}", error);
        Vec::new()
    })
}

fn persist_success(task: &CloudJobTask, items: Vec<RecommendationItem>) {
    if !task.is_current() {
        return;
    }
    // 先完成 DB 写入、释放 conn 锁，再获取 jobs 锁：
    // 避免 jobs → conn 嵌套持锁把 conn 锁等待传染给所有 jobs 锁使用方。
    {
        let guard = task.conn.lock();
        if let Err(error) = save_cloud_recommendation_result(
            &guard,
            &task.context,
            &task.job_id,
            "已完成本地召回、新歌发现和云端重排",
            &items,
        ) {
            log::warn!("保存云端推荐快照失败，本次结果仍返回当前任务: {}", error);
            *task.last_llm_error.lock() = Some(error);
        }
    }
    let payload = {
        let mut jobs = task.jobs.lock();
        if !task.is_current() {
            return;
        }
        let Some(job) = jobs.get_mut(&task.job_id) else {
            return;
        };
        if !matches!(job.status, RecommendationJobStatus::Running) {
            return;
        }
        job.status = RecommendationJobStatus::Done;
        job.stage = RecommendationJobStage::Done;
        job.detail = "已完成本地召回、新歌发现和云端重排".to_string();
        job.items = items;
        job.error = None;
        job.updated_at = catalog::now_ms();
        job_update_payload(job)
    };
    emit_job_payload(&task.app, payload);
}
