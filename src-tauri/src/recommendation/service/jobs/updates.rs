use super::*;
use tauri::Emitter;

impl RecommendationService {
    pub(super) fn publish_recommendation_job(
        &self,
        prepared: PreparedJob,
    ) -> CommandResult<RecommendationJob> {
        // 候选计算不持有这两把锁；发布、失效与清理按相同顺序同步。
        let mut cancel = self.cloud_cancel.lock();
        let job = prepared.job;
        let cancel_rx = {
            let mut jobs = self.recommendation_jobs.lock();
            if self.recommendation_generation.load(Ordering::SeqCst) != prepared.generation {
                return Err(CommandError::cancelled("推荐请求已过期"));
            }
            if let Some(running) = jobs
                .values()
                .find(|job| matches!(job.status, RecommendationJobStatus::Running))
            {
                return Ok(running.clone());
            }
            let receiver = prepared.task.as_ref().map(|_| {
                let (sender, receiver) = watch::channel(false);
                *cancel = sender;
                receiver
            });
            jobs.insert(job.job_id.clone(), job.clone());
            receiver
        };
        // 在释放发布锁前发出初始状态，避免覆盖随后发出的失效通知。
        emit_job_update(self.app_handle(), &job);
        if let (Some(task), Some(cancel_rx)) = (prepared.task, cancel_rx) {
            self.last_dynamic_refresh_at
                .store(catalog::now_ms(), Ordering::SeqCst);
            tauri::async_runtime::spawn(run_cloud_job(task, cancel_rx));
        }
        Ok(job)
    }
}

pub(super) fn job_update_payload(job: &RecommendationJob) -> RecommendationJobUpdatePayload {
    RecommendationJobUpdatePayload {
        job_id: job.job_id.clone(),
        status: job.status.clone(),
        stage: job.stage.clone(),
        detail: Some(job.detail.clone()),
    }
}

/// 契约 §4.3：状态事件不携带 items，前端在 done 后重新拉取完整结果。
pub(super) fn emit_job_payload(app: &tauri::AppHandle, payload: RecommendationJobUpdatePayload) {
    if let Err(error) = app.emit("recommendation-job-update", payload) {
        log::warn!("推送推荐任务状态事件失败: {}", error);
    }
}

pub(super) fn emit_job_update(app: &tauri::AppHandle, job: &RecommendationJob) {
    emit_job_payload(app, job_update_payload(job));
}

/// Target state applied to a running job by `update_recommendation_job`.
pub(super) struct JobTransition {
    pub(super) status: RecommendationJobStatus,
    pub(super) stage: RecommendationJobStage,
    pub(super) detail: String,
    pub(super) items: Option<Vec<RecommendationItem>>,
    pub(super) error: Option<String>,
}

/// Marks a still-running job as entering `stage` with a new detail text.
pub(super) fn mark_job_stage(
    app: &tauri::AppHandle,
    jobs: &Arc<Mutex<HashMap<String, RecommendationJob>>>,
    job_id: &str,
    stage: RecommendationJobStage,
    detail: &str,
) {
    update_recommendation_job(
        app,
        jobs,
        job_id,
        JobTransition {
            status: RecommendationJobStatus::Running,
            stage,
            detail: detail.to_string(),
            items: None,
            error: None,
        },
    );
}

pub(super) fn update_recommendation_job(
    app: &tauri::AppHandle,
    jobs: &Arc<Mutex<HashMap<String, RecommendationJob>>>,
    job_id: &str,
    transition: JobTransition,
) {
    let payload = {
        let mut jobs = jobs.lock();
        let Some(job) = jobs.get_mut(job_id) else {
            return;
        };
        if !matches!(&job.status, RecommendationJobStatus::Running) {
            return;
        }
        job.status = transition.status;
        if !matches!(job.status, RecommendationJobStatus::Running) {
            job.deadline_at = None;
        }
        job.stage = transition.stage;
        job.detail = transition.detail;
        if let Some(items) = transition.items {
            job.items = items;
        }
        job.error = transition.error;
        job.updated_at = catalog::now_ms();
        job_update_payload(job)
    };
    emit_job_payload(app, payload);
}
