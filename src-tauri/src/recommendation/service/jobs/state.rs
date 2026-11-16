use super::*;

pub(super) fn disabled_job() -> RecommendationJob {
    let mut job = build_initial_job(false, &[], Vec::new());
    job.status = RecommendationJobStatus::Disabled;
    job.stage = RecommendationJobStage::Disabled;
    job.detail = "推荐已关闭".into();
    job.local_updated_at = 0;
    job.result_updated_at = 0;
    job
}

pub(in crate::recommendation::service) fn idle_job() -> RecommendationJob {
    let mut job = build_initial_job(false, &[], Vec::new());
    job.status = RecommendationJobStatus::Idle;
    job.stage = RecommendationJobStage::Cleared;
    job.detail = "暂无推荐".into();
    job.local_updated_at = 0;
    job.result_updated_at = 0;
    job
}

pub(super) fn build_initial_job(
    can_use_cloud: bool,
    local: &[RecommendationItem],
    visible_items: Vec<RecommendationItem>,
) -> RecommendationJob {
    let now = catalog::now_ms();
    RecommendationJob {
        job_id: new_job_id(),
        status: if can_use_cloud {
            RecommendationJobStatus::Running
        } else {
            RecommendationJobStatus::Done
        },
        stage: if can_use_cloud {
            RecommendationJobStage::DiscoveryPlan
        } else {
            RecommendationJobStage::LocalOnly
        },
        detail: initial_job_detail(can_use_cloud, local.is_empty(), !visible_items.is_empty()),
        items: visible_items,
        error: None,
        updated_at: now,
        deadline_at: None,
        local_count: local.len(),
        local_updated_at: now,
        cloud_enabled: can_use_cloud,
        result_updated_at: if can_use_cloud { 0 } else { now },
        next_refresh_at: None,
    }
}

pub(super) fn initial_job_detail(
    can_use_cloud: bool,
    local_empty: bool,
    has_visible: bool,
) -> String {
    match (can_use_cloud, local_empty, has_visible) {
        (true, _, true) => "正在刷新推荐，保留最近一次结果",
        (true, _, false) => "正在生成推荐",
        (false, true, _) => "暂无推荐",
        (false, false, _) => "本地推荐已更新",
    }
    .to_string()
}

pub(in crate::recommendation::service) fn new_request_id() -> String {
    format!("rec-{}", catalog::now_ms())
}

pub(super) fn new_job_id() -> String {
    static JOB_SEQ: AtomicU64 = AtomicU64::new(1);
    format!(
        "rec-job-{}-{}",
        catalog::now_ms(),
        JOB_SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

/// 取消保持旧结果；取消时间不能冒充结果完成时间。
pub(in crate::recommendation::service) fn invalidate_recommendation_state(
    generation: &AtomicU64,
    jobs: &Mutex<HashMap<String, RecommendationJob>>,
    refresh_pending: &AtomicBool,
) -> Vec<RecommendationJobUpdatePayload> {
    let mut jobs = jobs.lock();
    generation.fetch_add(1, Ordering::SeqCst);
    let mut transitions = Vec::new();
    for job in jobs.values_mut() {
        if matches!(
            &job.status,
            RecommendationJobStatus::Running | RecommendationJobStatus::Waiting
        ) {
            job.status = RecommendationJobStatus::Cancelled;
            job.deadline_at = None;
            job.next_refresh_at = None;
            job.stage = RecommendationJobStage::Cancelled;
            job.detail = "已取消，等待重新生成".into();
            job.error = None;
            job.updated_at = catalog::now_ms();
            transitions.push(job_update_payload(job));
        }
    }
    refresh_pending.store(false, Ordering::SeqCst);
    transitions
}

pub(in crate::recommendation::service) fn is_current_generation(
    task_generation: u64,
    current_generation: u64,
) -> bool {
    task_generation == current_generation
}
