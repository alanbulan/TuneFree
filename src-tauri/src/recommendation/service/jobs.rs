use super::storage::load_latest_cloud_recommendation_job;
use super::*;

pub(super) mod cloud;
mod updates;

use cloud::{cloud_job_timeout_ms, run_cloud_job, CloudJobTask};
use updates::{
    emit_job_payload, emit_job_update, job_update_payload, mark_job_stage,
    update_recommendation_job, JobTransition,
};

struct PreparedJob {
    job: RecommendationJob,
    task: Option<CloudJobTask>,
}

/// Per-job LLM parameters read from `llm_config` in a single lock scope.
struct CloudJobConfig {
    candidate_window: usize,
    per_request_timeout_ms: u64,
}

impl RecommendationService {
    pub fn start_recommendation_job(
        &self,
        query: RecommendationQuery,
    ) -> CommandResult<RecommendationJob> {
        self.db_handle()?;
        self.prune_recommendation_jobs();
        if !self.is_recommendation_enabled() {
            return Ok(disabled_job());
        }
        // 并发防抖：同一时刻只允许一个云端任务，重复触发直接复用现有任务。
        if let Some(job) = self.running_recommendation_job() {
            return Ok(job);
        }
        let prepared = self.prepare_recommendation_job(query)?;
        let job = prepared.job;
        self.recommendation_jobs
            .lock()
            .insert(job.job_id.clone(), job.clone());
        emit_job_update(self.app_handle(), &job);
        if let Some(task) = prepared.task {
            self.last_dynamic_refresh_at
                .store(catalog::now_ms(), Ordering::SeqCst);
            let cancel_rx = self.next_cloud_cancel_receiver();
            tauri::async_runtime::spawn(run_cloud_job(task, cancel_rx));
        }
        Ok(job)
    }

    fn prepare_recommendation_job(&self, query: RecommendationQuery) -> CommandResult<PreparedJob> {
        let conn = self.conn_handle()?;
        let context = recommendation_context(&query);
        let persisted_items = self.latest_cloud_recommendation_items(&context);
        let (local, request_id) = self
            .local_items_with_request(&query)
            .map_err(CommandError::database)?;
        let can_use_cloud = self.has_cloud_recommendation_config();
        let visible_items = if can_use_cloud {
            persisted_items.unwrap_or_default()
        } else {
            local.clone()
        };
        let job = build_initial_job(can_use_cloud, &local, visible_items.clone());
        let config = self.cloud_job_config();
        let task = can_use_cloud.then(|| CloudJobTask {
            conn,
            app: self.app.clone(),
            provider: self.provider.clone(),
            client: self.client.clone(),
            jobs: Arc::clone(&self.recommendation_jobs),
            last_llm_error: Arc::clone(&self.last_llm_error),
            generation_state: Arc::clone(&self.recommendation_generation),
            generation: self.recommendation_generation.load(Ordering::SeqCst),
            job_id: job.job_id.clone(),
            query,
            local,
            request_id,
            context,
            candidate_window: config.candidate_window,
            total_timeout_ms: cloud_job_timeout_ms(config.per_request_timeout_ms),
            fallback_items: visible_items,
        });
        Ok(PreparedJob { job, task })
    }

    fn local_items_with_request(
        &self,
        query: &RecommendationQuery,
    ) -> Result<(Vec<RecommendationItem>, String), String> {
        let items = self.local_recommendations(query, "local")?;
        let request_id = items
            .first()
            .map(|item| item.request_id.clone())
            .unwrap_or_else(new_request_id);
        Ok((items, request_id))
    }

    fn cloud_job_config(&self) -> CloudJobConfig {
        let fallback = CloudJobConfig {
            candidate_window: MERGED_CANDIDATE_LIMIT,
            per_request_timeout_ms: 8000,
        };
        let Ok(conn) = self.conn_handle() else {
            return fallback;
        };
        let guard = conn.lock();
        llm_config::load_config(&guard)
            .map(|config| CloudJobConfig {
                candidate_window: config.max_candidates,
                per_request_timeout_ms: config.timeout_ms,
            })
            .unwrap_or(fallback)
    }

    pub(super) fn start_startup_recommendation_job(
        &self,
    ) -> CommandResult<Option<RecommendationJob>> {
        self.db_handle()?;
        self.prune_recommendation_jobs();
        if !self.is_recommendation_enabled() {
            return Ok(None);
        }
        if let Some(job) = self.running_recommendation_job() {
            return Ok(Some(job));
        }
        self.start_recommendation_job(RecommendationQuery {
            limit: Some(30),
            seed: None,
            context: Some("home".to_string()),
        })
        .map(Some)
    }

    pub fn get_latest_recommendation_job(&self) -> CommandResult<Option<RecommendationJob>> {
        self.db_handle()?;
        self.prune_recommendation_jobs();
        if !self.is_recommendation_enabled() {
            return Ok(None);
        }
        Ok(self
            .latest_recommendation_job()
            .or_else(|| self.latest_cloud_recommendation_job("home")))
    }

    /// 纯内存查询：不触碰数据库，未初始化时也可安全调用。
    pub fn get_recommendation_job(&self, job_id: String) -> Option<RecommendationJob> {
        self.prune_recommendation_jobs();
        self.recommendation_jobs.lock().get(&job_id).cloned()
    }

    fn has_cloud_recommendation_config(&self) -> bool {
        let Ok(conn) = self.conn_handle() else {
            return false;
        };
        let conn = conn.lock();
        let Ok(config) = llm_config::load_config(&conn) else {
            return false;
        };
        if !config.enabled || config.base_url.trim().is_empty() || config.model.trim().is_empty() {
            return false;
        }
        llm_config::get_api_key(&conn)
            .map(|key| !key.trim().is_empty())
            .unwrap_or(false)
    }

    fn is_recommendation_enabled(&self) -> bool {
        let Ok(conn) = self.conn_handle() else {
            return false;
        };
        let conn = conn.lock();
        llm_config::load_recommendation_enabled(&conn).unwrap_or(true)
    }

    fn latest_recommendation_job(&self) -> Option<RecommendationJob> {
        self.recommendation_jobs
            .lock()
            .values()
            .cloned()
            .max_by_key(|job| job.updated_at)
    }

    fn running_recommendation_job(&self) -> Option<RecommendationJob> {
        self.recommendation_jobs
            .lock()
            .values()
            .filter(|job| matches!(&job.status, RecommendationJobStatus::Running))
            .cloned()
            .max_by_key(|job| job.updated_at)
    }

    fn has_running_recommendation_job(&self) -> bool {
        self.recommendation_jobs
            .lock()
            .values()
            .any(|job| matches!(&job.status, RecommendationJobStatus::Running))
    }

    pub(super) fn invalidate_and_schedule_refresh(&self, reason: &'static str) {
        self.cancel_inflight_cloud_job();
        let transitions = invalidate_recommendation_state(
            &self.recommendation_generation,
            &self.recommendation_jobs,
            &self.dynamic_refresh_pending,
        );
        for payload in transitions {
            emit_job_payload(self.app_handle(), payload);
        }
        self.schedule_dynamic_recommendation_refresh(reason);
    }

    pub(super) fn schedule_dynamic_recommendation_refresh(&self, reason: &'static str) {
        if !self.is_recommendation_enabled() {
            return;
        }
        if self.dynamic_refresh_pending.swap(true, Ordering::SeqCst) {
            return;
        }

        let service = self.clone();
        let generation = self.recommendation_generation.load(Ordering::SeqCst);
        tauri::async_runtime::spawn(async move {
            let mut delay_ms = DYNAMIC_REFRESH_DEBOUNCE_MS;
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                service.prune_recommendation_jobs();

                if service.recommendation_generation.load(Ordering::SeqCst) != generation {
                    break;
                }
                if !service.is_recommendation_enabled() {
                    break;
                }
                if service.has_running_recommendation_job() {
                    delay_ms = DYNAMIC_REFRESH_RUNNING_RETRY_MS;
                    continue;
                }

                let now = catalog::now_ms();
                let last_refresh = service.last_dynamic_refresh_at.load(Ordering::SeqCst);
                let elapsed = now.saturating_sub(last_refresh);
                if elapsed < DYNAMIC_REFRESH_MIN_INTERVAL_MS {
                    delay_ms = (DYNAMIC_REFRESH_MIN_INTERVAL_MS - elapsed) as u64;
                    continue;
                }

                let refresh = service.start_recommendation_job(RecommendationQuery {
                    limit: Some(30),
                    seed: None,
                    context: Some("home".to_string()),
                });
                if let Err(e) = refresh {
                    log::error!("动态刷新智能推荐失败({}): {}", reason, e);
                } else {
                    log::info!("已触发动态智能推荐刷新: {}", reason);
                }
                break;
            }
            if is_current_generation(
                generation,
                service.recommendation_generation.load(Ordering::SeqCst),
            ) {
                service
                    .dynamic_refresh_pending
                    .store(false, Ordering::SeqCst);
            }
        });
    }

    fn latest_cloud_recommendation_items(&self, context: &str) -> Option<Vec<RecommendationItem>> {
        let conn = self.conn_handle().ok()?;
        let conn = conn.lock();
        let job = match load_latest_cloud_recommendation_job(&conn, context) {
            Ok(job) => job?,
            Err(error) => {
                log::warn!("读取云端推荐快照失败，等待后台重新生成: {}", error);
                return None;
            }
        };
        Some(
            exclusions::filter_items(&conn, job.items).unwrap_or_else(|error| {
                log::warn!("过滤云端推荐快照失败，忽略旧快照: {}", error);
                Vec::new()
            }),
        )
    }

    fn latest_cloud_recommendation_job(&self, context: &str) -> Option<RecommendationJob> {
        let conn = self.conn_handle().ok()?;
        let conn = conn.lock();
        let mut job = match load_latest_cloud_recommendation_job(&conn, context) {
            Ok(job) => job?,
            Err(error) => {
                log::warn!("读取云端推荐任务快照失败，等待后台重新生成: {}", error);
                return None;
            }
        };
        job.items = exclusions::filter_items(&conn, job.items).unwrap_or_else(|error| {
            log::warn!("过滤云端推荐任务快照失败，忽略旧快照: {}", error);
            Vec::new()
        });
        Some(job)
    }

    fn prune_recommendation_jobs(&self) {
        let now = catalog::now_ms();
        self.recommendation_jobs.lock().retain(|_, job| {
            matches!(&job.status, RecommendationJobStatus::Running)
                || now.saturating_sub(job.updated_at) <= RECOMMENDATION_JOB_TTL_MS
        });
    }
}

fn disabled_job() -> RecommendationJob {
    RecommendationJob {
        job_id: new_job_id(),
        status: RecommendationJobStatus::Done,
        stage: RecommendationJobStage::Done,
        detail: "智能推荐未启用".to_string(),
        items: Vec::new(),
        error: None,
        updated_at: catalog::now_ms(),
    }
}

fn build_initial_job(
    can_use_cloud: bool,
    local: &[RecommendationItem],
    visible_items: Vec<RecommendationItem>,
) -> RecommendationJob {
    let (status, stage) = initial_job_state(can_use_cloud, local.is_empty());
    RecommendationJob {
        job_id: new_job_id(),
        status,
        stage,
        detail: initial_job_detail(can_use_cloud, local.is_empty(), !visible_items.is_empty()),
        items: visible_items,
        error: None,
        updated_at: catalog::now_ms(),
    }
}

fn initial_job_state(
    can_use_cloud: bool,
    local_is_empty: bool,
) -> (RecommendationJobStatus, RecommendationJobStage) {
    if can_use_cloud {
        (
            RecommendationJobStatus::Running,
            RecommendationJobStage::DiscoveryPlan,
        )
    } else if local_is_empty {
        (RecommendationJobStatus::Done, RecommendationJobStage::Done)
    } else {
        (
            RecommendationJobStatus::Done,
            RecommendationJobStage::LocalOnly,
        )
    }
}

fn initial_job_detail(can_use_cloud: bool, local_empty: bool, has_visible: bool) -> String {
    match (can_use_cloud, local_empty, has_visible) {
        (true, _, true) => "已加载最近一次云端智能推荐，后台正在刷新",
        (true, true, false) => "本地候选为空，云端正在生成发现方向",
        (true, false, false) => "本地候选已返回，云端正在生成发现方向",
        (false, true, _) => "本地候选为空，云端发现与重排未启用",
        (false, false, _) => "云端发现与重排未启用，已返回本地推荐",
    }
    .to_string()
}

pub(super) fn new_request_id() -> String {
    format!("rec-{}", catalog::now_ms())
}

fn new_job_id() -> String {
    static JOB_SEQ: AtomicU64 = AtomicU64::new(1);
    format!(
        "rec-job-{}-{}",
        catalog::now_ms(),
        JOB_SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

pub(super) fn is_current_generation(task_generation: u64, current_generation: u64) -> bool {
    task_generation == current_generation
}

/// Marks running jobs as superseded and bumps the generation. Returns the
/// event payloads for the transitions so callers can notify the renderer.
pub(super) fn invalidate_recommendation_state(
    generation: &AtomicU64,
    jobs: &Mutex<HashMap<String, RecommendationJob>>,
    refresh_pending: &AtomicBool,
) -> Vec<RecommendationJobUpdatePayload> {
    let mut jobs = jobs.lock();
    generation.fetch_add(1, Ordering::SeqCst);
    let now = catalog::now_ms();
    let mut transitions = Vec::new();
    for job in jobs.values_mut() {
        if matches!(&job.status, RecommendationJobStatus::Running) {
            job.status = RecommendationJobStatus::Done;
            job.stage = RecommendationJobStage::Done;
            job.detail = "推荐数据已更新，当前任务已失效并等待重新生成".to_string();
            job.error = None;
            job.updated_at = now;
            transitions.push(job_update_payload(job));
        }
    }
    refresh_pending.store(false, Ordering::SeqCst);
    transitions
}

fn recommendation_context(query: &RecommendationQuery) -> String {
    query
        .context
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(if query.seed.is_some() {
            "similar"
        } else {
            "home"
        })
        .to_string()
}
