use super::*;
use crate::recommendation::credential_store::test_fixture::Credentials;
use crate::recommendation::service::tests::initialized_service;
use crate::test_support::config_input;
use std::time::Duration;

async fn wait_until(mut condition: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(55), async {
        while !condition() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("推荐任务应在约定的调度窗口内完成");
}

#[tokio::test]
async fn concurrent_requests_reuse_one_cloud_job() {
    let _credentials = Credentials::new().await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let app = crate::test_support::app();
    let service = initialized_service(&app);
    llm_config::save_config(
        &service.conn_handle().unwrap().lock(),
        config_input(&format!("http://{}", listener.local_addr().unwrap())),
    )
    .unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(12));
    let requests: Vec<_> = (0..12)
        .map(|_| {
            let service = service.clone();
            let barrier = barrier.clone();
            tokio::task::spawn_blocking(move || {
                barrier.wait();
                service.start_recommendation_job(RecommendationQuery {
                    limit: Some(5),
                    seed: None,
                    context: Some("home".into()),
                })
            })
        })
        .collect();
    let mut ids = HashSet::new();
    for request in requests {
        ids.insert(request.await.unwrap().unwrap().job_id);
    }
    service.cancel_inflight_cloud_job();
    assert_eq!(ids.len(), 1, "并发触发必须共享同一个云端任务");
    assert!(service.last_dynamic_refresh_at.load(Ordering::SeqCst) > 0);
}

#[tokio::test]
async fn invalidated_or_cleared_preparations_cannot_publish_stale_jobs() {
    let _credentials = Credentials::new().await;
    let model = crate::test_support::LlmServer::contents(&[]).await;
    let app = crate::test_support::app();
    for use_cloud in [false, true] {
        for clear_data in [false, true] {
            let service = initialized_service(&app);
            if use_cloud {
                llm_config::save_config(
                    &service.conn_handle().unwrap().lock(),
                    config_input(&model.base_url),
                )
                .unwrap();
            }
            let prepared = service
                .prepare_recommendation_job(RecommendationQuery {
                    limit: Some(5),
                    seed: None,
                    context: Some("home".into()),
                })
                .unwrap();
            assert_eq!(prepared.task.is_some(), use_cloud);
            if clear_data {
                service.clear_data().unwrap();
            } else {
                invalidate_recommendation_state(
                    &service.recommendation_generation,
                    &service.recommendation_jobs,
                    &service.dynamic_refresh_pending,
                );
            }
            assert_eq!(
                service
                    .publish_recommendation_job(prepared)
                    .unwrap_err()
                    .code,
                crate::app::error::ErrorCode::Cancelled
            );
            assert!(service.recommendation_jobs.lock().is_empty());
            assert_eq!(service.last_dynamic_refresh_at.load(Ordering::SeqCst), 0);
        }
    }
    assert!(model.calls.lock().is_empty(), "旧请求不得调用模型");
}

#[tokio::test]
async fn a_published_job_receives_cancellation_when_data_is_cleared() {
    let _credentials = Credentials::new().await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let app = crate::test_support::app();
    let service = initialized_service(&app);
    llm_config::save_config(
        &service.conn_handle().unwrap().lock(),
        config_input(&format!("http://{}", listener.local_addr().unwrap())),
    )
    .unwrap();
    let job = service
        .start_recommendation_job(RecommendationQuery {
            limit: Some(5),
            seed: None,
            context: Some("home".into()),
        })
        .unwrap();
    let mut cancel_rx = service.cloud_cancel.lock().subscribe();
    assert!(matches!(job.status, RecommendationJobStatus::Running));
    assert!(!*cancel_rx.borrow());
    service.clear_data().unwrap();
    tokio::time::timeout(Duration::from_secs(2), cancel_rx.changed())
        .await
        .unwrap()
        .unwrap();
    assert!(*cancel_rx.borrow());
    assert!(service.get_recommendation_job(job.job_id).is_none());
    assert!(service.recommendation_jobs.lock().is_empty());
}

#[tokio::test]
async fn dynamic_refresh_debounces_and_stops_for_disabled_or_invalidated_requests() {
    let app = crate::test_support::app();
    let debounced = initialized_service(&app);
    let disabled = initialized_service(&app);
    disabled
        .conn_handle()
        .unwrap()
        .lock()
        .execute("UPDATE recommendation_settings SET enabled = 0", [])
        .unwrap();
    let invalidated = initialized_service(&app);
    let broken = initialized_service(&app);
    broken
        .conn_handle()
        .unwrap()
        .lock()
        .execute_batch("DROP TABLE tracks")
        .unwrap();
    debounced.schedule_dynamic_recommendation_refresh("连续输入");
    debounced.schedule_dynamic_recommendation_refresh("重复输入");
    disabled.schedule_dynamic_recommendation_refresh("已关闭推荐");
    invalidated.schedule_dynamic_recommendation_refresh("旧请求");
    invalidated
        .recommendation_generation
        .fetch_add(1, Ordering::SeqCst);
    broken.schedule_dynamic_recommendation_refresh("数据库不可读");
    assert!(debounced.recommendation_jobs.lock().is_empty());
    wait_until(|| {
        !debounced.dynamic_refresh_pending.load(Ordering::SeqCst)
            && !disabled.dynamic_refresh_pending.load(Ordering::SeqCst)
            && !broken.dynamic_refresh_pending.load(Ordering::SeqCst)
            && Arc::strong_count(&invalidated.dynamic_refresh_pending) == 1
    })
    .await;
    assert_eq!(debounced.recommendation_jobs.lock().len(), 1);
    assert!(disabled.recommendation_jobs.lock().is_empty());
    assert!(broken.recommendation_jobs.lock().is_empty());
    assert!(invalidated.recommendation_jobs.lock().is_empty());
    assert!(
        invalidated.dynamic_refresh_pending.load(Ordering::SeqCst),
        "旧任务不得清除新一代任务的 pending 标记"
    );
}

#[tokio::test]
async fn dynamic_refresh_respects_the_minimum_interval_and_retries_after_a_running_job() {
    let app = crate::test_support::app();
    let throttled = initialized_service(&app);
    throttled.last_dynamic_refresh_at.store(
        catalog::now_ms() - DYNAMIC_REFRESH_MIN_INTERVAL_MS + 25_000,
        Ordering::SeqCst,
    );
    let busy = initialized_service(&app);
    let running = build_initial_job(true, &[], vec![]);
    busy.recommendation_jobs
        .lock()
        .insert(running.job_id.clone(), running.clone());
    throttled.schedule_dynamic_recommendation_refresh("刷新间隔");
    busy.schedule_dynamic_recommendation_refresh("等待当前请求");
    tokio::time::sleep(Duration::from_millis(DYNAMIC_REFRESH_DEBOUNCE_MS + 1000)).await;
    assert!(throttled.recommendation_jobs.lock().is_empty());
    assert!(throttled.dynamic_refresh_pending.load(Ordering::SeqCst));
    assert_eq!(busy.recommendation_jobs.lock().len(), 1);
    assert!(busy.dynamic_refresh_pending.load(Ordering::SeqCst));
    busy.recommendation_jobs
        .lock()
        .get_mut(&running.job_id)
        .unwrap()
        .status = RecommendationJobStatus::Done;
    wait_until(|| {
        !throttled.dynamic_refresh_pending.load(Ordering::SeqCst)
            && !busy.dynamic_refresh_pending.load(Ordering::SeqCst)
    })
    .await;
    assert_eq!(throttled.recommendation_jobs.lock().len(), 1);
    assert_eq!(busy.recommendation_jobs.lock().len(), 2);
}

#[tokio::test]
async fn invalidation_emits_the_superseded_job_before_scheduling_a_refresh() {
    use tauri::Listener;
    let app = crate::test_support::app();
    let service = initialized_service(&app);
    let job = build_initial_job(true, &[], vec![]);
    service
        .recommendation_jobs
        .lock()
        .insert(job.job_id.clone(), job.clone());
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed = events.clone();
    let listener = app.listen("recommendation-job-update", move |event| {
        observed
            .lock()
            .push(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap());
    });
    service.invalidate_and_schedule_refresh("偏好发生变化");
    assert_eq!(service.recommendation_generation.load(Ordering::SeqCst), 2);
    let current = service.get_recommendation_job(job.job_id.clone()).unwrap();
    assert!(matches!(current.status, RecommendationJobStatus::Done));
    assert!(current.detail.contains("已失效"));
    assert!(events
        .lock()
        .iter()
        .any(|event| event["jobId"] == job.job_id));
    app.unlisten(listener);
    service
        .conn_handle()
        .unwrap()
        .lock()
        .execute("UPDATE recommendation_settings SET enabled = 0", [])
        .unwrap();
    wait_until(|| !service.dynamic_refresh_pending.load(Ordering::SeqCst)).await;
}
