use super::*;
use crate::recommendation::credential_store::test_fixture::Credentials;
use crate::recommendation::service::tests::initialized_service;
use crate::test_support::{config_input, https::HttpsServer, LlmServer};
use serde_json::json;

fn prepared_task(app: &tauri::App, base_url: &str) -> CloudJobTask {
    let service = initialized_service(app);
    let conn = service.conn_handle().unwrap();
    let song: RecSong = serde_json::from_value(json!({
        "id":"1", "source":"qq", "name":"本地歌曲", "artist":"歌手", "album":"专辑"
    }))
    .unwrap();
    catalog::upsert_track(&conn.lock(), &song).unwrap();
    llm_config::save_config(&conn.lock(), config_input(base_url)).unwrap();
    let prepared = service
        .prepare_recommendation_job(RecommendationQuery {
            limit: Some(3),
            seed: None,
            context: Some("home".into()),
        })
        .unwrap();
    service
        .recommendation_jobs
        .lock()
        .insert(prepared.job.job_id.clone(), prepared.job);
    prepared.task.unwrap()
}

fn current_job(task: &CloudJobTask) -> RecommendationJob {
    task.jobs.lock().get(&task.job_id).unwrap().clone()
}

#[tokio::test]
async fn verified_platform_discovery_is_merged_ranked_and_persisted() {
    let _credentials = Credentials::new().await;
    let model = LlmServer::contents(&[
        r#"{"queries":[{"keyword":"新歌手","source":"qq","reason":"歌手偏好"}]}"#,
        r#"{"items":[{"track_key":"qq:2","rank":1,"reason":"发现新歌"}]}"#,
    ])
    .await;
    let platform = HttpsServer::start(json!([{
        "host":"u.y.qq.com", "path":"/cgi-bin/musicu.fcg",
        "body":json!({"req":{"data":{"body":{"song":{"list":[{
            "mid":"2", "name":"真实新歌", "singer":[{"name":"新歌手"}]
        }]}}}}}).to_string()
    }]));
    let app = crate::test_support::app();
    let mut task = prepared_task(&app, &model.base_url);
    task.client = platform.client.clone();
    let (_sender, receiver) = watch::channel(false);
    run_cloud_job(task.clone(), receiver).await;
    let job = current_job(&task);
    assert!(matches!(job.status, RecommendationJobStatus::Done));
    assert_eq!(job.items[0].song.name, "真实新歌");
    assert_eq!(platform.calls().len(), 1);
    assert_eq!(model.calls.lock().len(), 2);
    assert!(task.last_llm_error.lock().is_none());
    assert!(job.deadline_at.is_none());
}

#[tokio::test]
async fn failed_reranking_preserves_the_previous_result_or_local_candidates() {
    let _credentials = Credentials::new().await;
    for has_previous_result in [false, true] {
        let server = LlmServer::contents(&[r#"{"queries":[]}"#, "invalid ranking"]).await;
        let app = crate::test_support::app();
        let mut task = prepared_task(&app, &server.base_url);
        let mut previous = task.local[0].clone();
        previous.request_id = "previous-result".into();
        if has_previous_result {
            task.fallback_items = vec![previous];
        }
        let (_sender, receiver) = watch::channel(false);
        run_cloud_job(task.clone(), receiver).await;
        let job = current_job(&task);
        assert!(matches!(job.status, RecommendationJobStatus::Error));
        assert_eq!(job.items.len(), 1);
        assert_eq!(
            job.items[0].request_id == "previous-result",
            has_previous_result
        );
        assert!(job.error.is_some());
        assert!(task.last_llm_error.lock().is_some());
        assert_eq!(server.calls.lock().len(), 2);
    }
}

#[tokio::test]
async fn an_empty_verified_candidate_set_does_not_issue_a_reranking_request() {
    let _credentials = Credentials::new().await;
    let server = LlmServer::contents(&[r#"{"queries":[]}"#]).await;
    let app = crate::test_support::app();
    let mut task = prepared_task(&app, &server.base_url);
    task.fallback_items = task.local.clone();
    task.local.clear();
    let (_sender, receiver) = watch::channel(false);
    run_cloud_job(task.clone(), receiver).await;
    let job = current_job(&task);
    assert!(matches!(job.status, RecommendationJobStatus::Error));
    assert_eq!(job.items.len(), 1);
    assert!(job.detail.contains("没有可用于重排"));
    assert_eq!(server.calls.lock().len(), 1);
}

#[tokio::test]
async fn cancellation_and_expired_generations_cannot_overwrite_newer_jobs() {
    let _credentials = Credentials::new().await;
    let server = LlmServer::contents(&[r#"{"queries":[]}"#]).await;
    let app = crate::test_support::app();
    let task = prepared_task(&app, &server.base_url);
    let (_sender, receiver) = watch::channel(true);
    run_cloud_job(task.clone(), receiver).await;
    assert!(server.calls.lock().is_empty());
    task.generation_state.fetch_add(1, Ordering::SeqCst);
    task.fail("旧任务", "不得覆盖".into(), vec![]);
    persist_success(&task, vec![]);
    let (_sender, receiver) = watch::channel(false);
    run_cloud_job(task.clone(), receiver).await;
    assert!(matches!(
        current_job(&task).status,
        RecommendationJobStatus::Running
    ));
    assert!(task.last_llm_error.lock().is_none());
    assert!(server.calls.lock().is_empty(), "失效任务不应发出云端请求");
}

#[tokio::test]
async fn the_total_deadline_stops_a_stalled_provider_and_preserves_fallback_items() {
    let _credentials = Credentials::new().await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let app = crate::test_support::app();
    let mut task = prepared_task(&app, &format!("http://{}", listener.local_addr().unwrap()));
    task.total_timeout_ms = 10;
    task.fallback_items = task.local.clone();
    let (_sender, receiver) = watch::channel(false);
    run_cloud_job(task.clone(), receiver).await;
    let job = current_job(&task);
    assert!(matches!(job.status, RecommendationJobStatus::Error));
    assert_eq!(job.items.len(), 1);
    assert!(job.error.unwrap().contains("总时限"));
}

#[tokio::test]
async fn storage_failures_keep_completed_results_but_never_bypass_exclusions() {
    let _credentials = Credentials::new().await;
    let app = crate::test_support::app();
    let task = prepared_task(&app, "http://127.0.0.1:1");
    task.conn
        .lock()
        .execute_batch("DROP TABLE recommendation_result_snapshots")
        .unwrap();
    persist_success(&task, task.local.clone());
    assert!(matches!(
        current_job(&task).status,
        RecommendationJobStatus::Done
    ));
    assert_eq!(current_job(&task).items.len(), 1);
    assert!(task
        .last_llm_error
        .lock()
        .as_ref()
        .unwrap()
        .contains("保存云端推荐结果失败"));
    persist_success(&task, vec![]);
    assert_eq!(current_job(&task).items.len(), 1);
    task.jobs.lock().clear();
    persist_success(&task, vec![]);
    assert!(task.jobs.lock().is_empty());
    task.conn
        .lock()
        .execute_batch("DROP TABLE dismissed_recommendations")
        .unwrap();
    assert!(filter_merged_candidates(&task, vec![]).is_empty());
}
