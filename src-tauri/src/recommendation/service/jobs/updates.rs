use super::*;
use tauri::Emitter;

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
