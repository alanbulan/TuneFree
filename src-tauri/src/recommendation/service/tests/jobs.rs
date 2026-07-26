use super::*;
use crate::app::error::ErrorCode;

#[test]
fn stale_dynamic_refresh_task_does_not_clear_new_generation() {
    assert!(is_current_generation(2, 2));
    assert!(!is_current_generation(1, 2));

    let generation = AtomicU64::new(2);
    let pending = AtomicBool::new(true);
    let jobs = Mutex::new(HashMap::from([
        (
            "running".to_string(),
            RecommendationJob {
                job_id: "running".to_string(),
                status: RecommendationJobStatus::Running,
                stage: RecommendationJobStage::CloudRerank,
                detail: String::new(),
                items: Vec::new(),
                error: None,
                updated_at: 1,
            },
        ),
        (
            "done".to_string(),
            RecommendationJob {
                job_id: "done".to_string(),
                status: RecommendationJobStatus::Done,
                stage: RecommendationJobStage::Done,
                detail: String::new(),
                items: Vec::new(),
                error: None,
                updated_at: 1,
            },
        ),
    ]));
    let transitions = invalidate_recommendation_state(&generation, &jobs, &pending);
    assert_eq!(generation.load(Ordering::SeqCst), 3);
    assert!(!pending.load(Ordering::SeqCst));
    assert!(matches!(
        &jobs.lock().get("running").unwrap().status,
        RecommendationJobStatus::Done
    ));
    assert!(jobs.lock().contains_key("done"));
    // 只有被作废的 running 任务需要向前端推送状态事件。
    assert_eq!(transitions.len(), 1);
    assert_eq!(transitions[0].job_id, "running");
}

#[test]
fn unready_service_reports_busy_instead_of_blocking() {
    let db: OnceLock<DbHandle> = OnceLock::new();
    let error = require_db(&db).err().expect("未初始化时必须返回 Busy");
    assert_eq!(error.code, ErrorCode::Busy);
    assert_eq!(error.message, "推荐服务正在初始化，请稍候");

    let conn = Connection::open_in_memory().unwrap();
    db.set(DbHandle {
        conn: Arc::new(Mutex::new(conn)),
        path: PathBuf::new(),
    })
    .ok();
    assert!(require_db(&db).is_ok());
}

#[test]
fn weak_signals_do_not_invalidate_inflight_jobs() {
    for weak in ["play_start", "play_30s", "play_complete", "download"] {
        assert!(!is_strong_signal(weak), "{weak} 不应作废在途任务");
    }
    for strong in [
        "favorite_add",
        "favorite_remove",
        "playlist_add",
        "dismiss",
        "skip_early",
    ] {
        assert!(is_strong_signal(strong), "{strong} 应立即作废在途任务");
    }
}

#[test]
fn weak_signal_refresh_requires_threshold_or_interval() {
    assert!(!should_refresh_for_weak_signals(1, 0));
    assert!(!should_refresh_for_weak_signals(
        19,
        DYNAMIC_REFRESH_MIN_INTERVAL_MS - 1
    ));
    assert!(should_refresh_for_weak_signals(20, 0));
    assert!(should_refresh_for_weak_signals(
        1,
        DYNAMIC_REFRESH_MIN_INTERVAL_MS
    ));
}

#[test]
fn cloud_job_timeout_scales_with_per_request_timeout() {
    // 单请求超时较小时维持 55 秒保底；较大时覆盖 2 阶段 × 2 次尝试 + 搜索预算。
    assert_eq!(cloud_job_timeout_ms(1_000), 55_000);
    assert_eq!(cloud_job_timeout_ms(8_000), 57_000);
    assert_eq!(cloud_job_timeout_ms(60_000), 265_000);
}

#[tokio::test]
async fn cancellation_signal_aborts_pending_future() {
    let (sender, mut receiver) = watch::channel(false);
    let handle = tokio::spawn(async move {
        with_cancellation(&mut receiver, std::future::pending::<()>()).await
    });
    sender.send(true).unwrap();
    let result = tokio::time::timeout(std::time::Duration::from_secs(1), handle)
        .await
        .expect("取消信号应立即中止挂起的请求")
        .unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn uncancelled_future_runs_to_completion() {
    let (_sender, mut receiver) = watch::channel(false);
    assert_eq!(with_cancellation(&mut receiver, async { 7 }).await, Some(7));
}

#[tokio::test]
async fn cancelling_one_job_does_not_touch_a_freshly_created_channel() {
    // `next_cloud_cancel_receiver` 的语义：新任务换一条新通道，旧任务的取消
    // 不能连带作废新任务。
    let (old_sender, mut old_receiver) = watch::channel(false);
    let (_new_sender, mut new_receiver) = watch::channel(false);
    old_sender.send(true).unwrap();

    assert!(with_cancellation(&mut old_receiver, async { 1 })
        .await
        .is_none());
    assert_eq!(
        with_cancellation(&mut new_receiver, async { 2 }).await,
        Some(2)
    );
}

#[test]
fn stale_generation_results_are_discarded_but_current_ones_kept() {
    let generation = AtomicU64::new(5);
    let pending = AtomicBool::new(false);
    let jobs = Mutex::new(HashMap::new());

    assert!(is_current_generation(5, generation.load(Ordering::SeqCst)));
    invalidate_recommendation_state(&generation, &jobs, &pending);
    // 作废后，此前抓取的第 5 代结果不得再写回。
    assert!(!is_current_generation(5, generation.load(Ordering::SeqCst)));
    assert!(is_current_generation(6, generation.load(Ordering::SeqCst)));
}

#[tokio::test]
async fn already_cancelled_signal_short_circuits() {
    let (sender, mut receiver) = watch::channel(false);
    sender.send(true).unwrap();
    assert!(with_cancellation(&mut receiver, async { 1 })
        .await
        .is_none());
}
