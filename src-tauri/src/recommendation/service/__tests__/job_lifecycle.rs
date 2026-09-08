use super::*;
use crate::recommendation::credential_store::test_fixture::Credentials;
use crate::recommendation::service::tests::initialized_service;
use crate::test_support::{config_input, LlmServer};

fn query() -> RecommendationQuery {
    RecommendationQuery {
        limit: Some(5),
        seed: None,
        context: None,
    }
}

#[test]
fn jobs_are_pruned_reused_and_gated_by_the_stored_switch() {
    let app = crate::test_support::app();
    let service = initialized_service(&app);
    let running = build_initial_job(true, &[], vec![]);
    let mut expired = build_initial_job(false, &[], vec![]);
    expired.updated_at = 0;
    {
        let mut jobs = service.recommendation_jobs.lock();
        jobs.insert(running.job_id.clone(), running.clone());
        jobs.insert(expired.job_id.clone(), expired.clone());
    }
    assert!(service.has_running_recommendation_job());
    assert_eq!(
        service.start_recommendation_job(query()).unwrap().job_id,
        running.job_id
    );
    assert_eq!(
        service
            .start_startup_recommendation_job()
            .unwrap()
            .unwrap()
            .job_id,
        running.job_id
    );
    assert!(service.get_recommendation_job(expired.job_id).is_none());
    let conn = service.conn_handle().unwrap();
    conn.lock()
        .execute("UPDATE recommendation_settings SET enabled=0", [])
        .unwrap();
    let disabled = service.start_recommendation_job(query()).unwrap();
    assert!(matches!(disabled.status, RecommendationJobStatus::Done));
    assert!(disabled.items.is_empty());
    assert_ne!(disabled.job_id, running.job_id);
    conn.lock()
        .execute("UPDATE recommendation_settings SET enabled=1", [])
        .unwrap();
    service.recommendation_jobs.lock().clear();
    assert!(service
        .start_startup_recommendation_job()
        .unwrap()
        .is_some());
    assert!(!service.has_running_recommendation_job());
    assert_eq!(recommendation_context(&query()), "home");
    let mut similar = query();
    similar.seed = Some(
        serde_json::from_value(
            serde_json::json!({"id":"1","source":"qq","name":"歌","artist":"人","album":""}),
        )
        .unwrap(),
    );
    assert_eq!(recommendation_context(&similar), "similar");
    assert!(initial_job_detail(true, false, true).contains("最近一次"));
    assert!(initial_job_detail(true, false, false).contains("本地候选已返回"));
    assert!(initial_job_detail(false, false, false).contains("本地推荐"));
}

#[test]
fn missing_or_unreadable_settings_fall_back_without_panicking() {
    let app = crate::test_support::app();
    let pending = RecommendationService::new_deferred(app.handle().clone(), reqwest::Client::new());
    assert!(!pending.has_cloud_recommendation_config());
    assert!(!pending.is_recommendation_enabled());
    assert_eq!(pending.cloud_job_config().per_request_timeout_ms, 8000);
    let service = initialized_service(&app);
    let conn = service.conn_handle().unwrap();
    conn.lock()
        .execute_batch("DROP TABLE llm_config; DROP TABLE recommendation_settings")
        .unwrap();
    assert!(!service.has_cloud_recommendation_config());
    assert!(service.is_recommendation_enabled());
    assert_eq!(
        service.cloud_job_config().candidate_window,
        MERGED_CANDIDATE_LIMIT
    );
    conn.lock()
        .execute_batch("DROP TABLE recommendation_result_snapshots")
        .unwrap();
    assert!(service.latest_cloud_recommendation_items("home").is_none());
    assert!(service.latest_cloud_recommendation_job("home").is_none());
}

#[tokio::test]
async fn cloud_job_uses_local_candidates_when_discovery_fails_and_persists_the_verified_result() {
    let _credentials = Credentials::new().await;
    let server = LlmServer::contents(&[
        r#"{"queries":[]}"#,
        r#"{"items":[{"track_key":"qq:1","rank":1,"reason":"喜欢的歌手"}]}"#,
    ])
    .await;
    let app = crate::test_support::app();
    let service = initialized_service(&app);
    let conn = service.conn_handle().unwrap();
    let item: RecSong = serde_json::from_value(
        serde_json::json!({"id":"1","source":"qq","name":"歌曲","artist":"歌手","album":""}),
    )
    .unwrap();
    catalog::upsert_track(&conn.lock(), &item).unwrap();
    llm_config::save_config(&conn.lock(), config_input(&server.base_url)).unwrap();
    assert!(service.has_cloud_recommendation_config());
    let started = service.start_recommendation_job(query()).unwrap();
    assert!(started.deadline_at.is_some());
    assert!(started.items.is_empty());
    let id = started.job_id;
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while matches!(
            service.get_recommendation_job(id.clone()).unwrap().status,
            RecommendationJobStatus::Running
        ) {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("公开启动入口应完成云端任务");
    let completed = service.get_recommendation_job(id.clone()).unwrap();
    assert!(matches!(completed.status, RecommendationJobStatus::Done));
    assert_eq!(completed.items.len(), 1);
    assert!(completed.deadline_at.is_none());
    assert_eq!(server.calls.lock().len(), 2);
    assert_eq!(
        service
            .latest_cloud_recommendation_items("home")
            .unwrap()
            .len(),
        1
    );
    service.recommendation_jobs.lock().clear();
    assert_eq!(
        service
            .get_latest_recommendation_job()
            .unwrap()
            .unwrap()
            .job_id,
        id
    );
    conn.lock()
        .execute_batch("DROP TABLE dismissed_recommendations")
        .unwrap();
    assert!(service
        .latest_cloud_recommendation_items("home")
        .unwrap()
        .is_empty());
    assert!(service
        .latest_cloud_recommendation_job("home")
        .unwrap()
        .items
        .is_empty());
}
