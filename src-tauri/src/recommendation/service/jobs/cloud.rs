use super::*;
use crate::recommendation::service::{
    candidates::merge_discovery_candidates, storage::save_cloud_recommendation_result,
};

const CLOUD_JOB_TIMEOUT_MS: u64 = 55_000;

pub(super) struct CloudJobTask {
    pub(super) conn: Arc<Mutex<Connection>>,
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
            &self.jobs,
            &self.job_id,
            RecommendationJobStatus::Error,
            RecommendationJobStage::Error,
            detail,
            Some(items),
            Some(error),
        );
    }
}

pub(super) async fn run_cloud_job(task: CloudJobTask) {
    let deadline = std::time::Duration::from_millis(CLOUD_JOB_TIMEOUT_MS);
    if tokio::time::timeout(deadline, execute_cloud_job(&task))
        .await
        .is_err()
    {
        task.fail(
            "云端推荐处理超时，保留最近一次可用结果",
            "云端推荐任务超过总时限".to_string(),
            task.fallback_items.clone(),
        );
    }
}

async fn execute_cloud_job(task: &CloudJobTask) {
    let Some((discovered, plan_error)) = plan_and_discover(task).await else {
        return;
    };
    let merged = filter_merged_candidates(task, discovered);
    if merged.is_empty() {
        let error = plan_error.unwrap_or_else(|| "平台搜索未找到可验证的新歌候选".to_string());
        task.fail(
            "没有可用于重排的真实候选，保留最近一次云端结果",
            error,
            task.fallback_items.clone(),
        );
        return;
    }
    update_recommendation_job(
        &task.jobs,
        &task.job_id,
        RecommendationJobStatus::Running,
        RecommendationJobStage::CloudRerank,
        "云端正在统一重排本地候选和真实新歌候选",
        None,
        None,
    );
    let result = llm::enhance_recommendations(
        Arc::clone(&task.conn),
        &task.provider,
        &task.query,
        merged,
        &task.request_id,
    )
    .await;
    if !task.is_current() {
        return;
    }
    if let Some(error) = result.error {
        let items = if task.fallback_items.is_empty() {
            result.items
        } else {
            task.fallback_items.clone()
        };
        task.fail("云端重排失败，保留最近一次可用结果", error, items);
        return;
    }
    persist_success(task, result.items);
}

async fn plan_and_discover(
    task: &CloudJobTask,
) -> Option<(Vec<discovery::DiscoveredSong>, Option<String>)> {
    update_recommendation_job(
        &task.jobs,
        &task.job_id,
        RecommendationJobStatus::Running,
        RecommendationJobStage::DiscoveryPlan,
        "云端正在生成新歌发现方向",
        None,
        None,
    );
    let plan = llm::build_discovery_plan(
        Arc::clone(&task.conn),
        &task.provider,
        &task.query,
        &task.local,
        &task.request_id,
        DISCOVERY_QUERY_LIMIT,
    )
    .await;
    if !task.is_current() {
        return None;
    }
    if let Some(error) = &plan.error {
        *task.last_llm_error.lock() = Some(error.clone());
    }
    if plan.queries.is_empty() {
        return Some((Vec::new(), plan.error));
    }
    update_recommendation_job(
        &task.jobs,
        &task.job_id,
        RecommendationJobStatus::Running,
        RecommendationJobStage::PlatformSearch,
        "正在通过平台搜索验证新歌候选",
        None,
        None,
    );
    let discovered = discovery::discover_songs(
        task.client.clone(),
        plan.queries,
        DISCOVERY_RESULTS_PER_SOURCE,
        DISCOVERY_CANDIDATE_LIMIT,
    )
    .await;
    task.is_current().then_some((discovered, plan.error))
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
    job.status = RecommendationJobStatus::Done;
    job.stage = RecommendationJobStage::Done;
    job.detail = "已完成本地召回、新歌发现和云端重排".to_string();
    job.items = items;
    job.error = None;
    job.updated_at = catalog::now_ms();
}
