use super::*;
use crate::recommendation::{
    credential_store::test_fixture::Credentials, migration, model::RecommendationQuery,
};
use crate::test_support::{config_input, LlmServer};
use serde_json::json;

fn database(base_url: &str) -> Arc<Mutex<Connection>> {
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    llm_config::save_config(&conn, config_input(base_url)).unwrap();
    Arc::new(Mutex::new(conn))
}

fn items() -> Vec<RecommendationItem> {
    serde_json::from_value(json!([
        {"song":{"id":"1","source":"qq","name":"歌曲一","artist":"歌手一","album":"专辑"},
         "score":0.8,"reasons":["收藏"],"recommendationSource":"local","requestId":"local"},
        {"song":{"id":"2","source":"qq","name":"歌曲二","artist":"歌手二","album":"专辑"},
         "score":0.6,"reasons":["画像"],"recommendationSource":"local","requestId":"local"}
    ]))
    .unwrap()
}

fn query() -> RecommendationQuery {
    RecommendationQuery {
        limit: Some(2),
        seed: None,
        context: Some("home".into()),
    }
}

const VALID_RANK: &str = r#"{"items":[{"track_key":"qq:2","rank":1,"reason":"适合夜晚"}]}"#;

#[tokio::test]
async fn successful_rerank_is_cached_and_rebound_to_the_current_request() {
    let _credentials = Credentials::new().await;
    let server = LlmServer::contents(&[VALID_RANK]).await;
    let conn = database(&server.base_url);
    let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
    let first = enhance_recommendations(conn.clone(), &provider, &query(), items(), "first").await;
    assert!(first.error.is_none());
    assert_eq!(first.items[0].song.id, "2");
    assert!(first
        .items
        .iter()
        .all(|item| item.recommendation_source == "hybrid"));
    let cached =
        enhance_recommendations(conn.clone(), &provider, &query(), items(), "cached").await;
    assert!(cached.error.is_none());
    assert!(cached.items.iter().all(|item| item.request_id == "cached"));
    assert_eq!(server.calls.lock().len(), 1);
    let statuses: String = conn
        .lock()
        .query_row("SELECT group_concat(status) FROM llm_calls", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(statuses, "ok,cache_hit");
}

#[tokio::test]
async fn invalid_cache_is_refreshed_and_nonessential_database_failures_do_not_discard_results() {
    let _credentials = Credentials::new().await;
    let server = LlmServer::contents(&[VALID_RANK, VALID_RANK, VALID_RANK]).await;
    let conn = database(&server.base_url);
    let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
    assert!(
        enhance_recommendations(conn.clone(), &provider, &query(), items(), "one")
            .await
            .error
            .is_none()
    );
    conn.lock()
        .execute(
            "UPDATE llm_recommendation_cache SET response_json='broken'",
            [],
        )
        .unwrap();
    assert!(
        enhance_recommendations(conn.clone(), &provider, &query(), items(), "two")
            .await
            .error
            .is_none()
    );
    conn.lock().execute_batch("UPDATE llm_config SET upload_recent_events=1;
        DROP TABLE llm_recommendation_cache; DROP TABLE user_profile; DROP TABLE play_events; DROP TABLE llm_calls;").unwrap();
    let result = enhance_recommendations(conn.clone(), &provider, &query(), items(), "three").await;
    assert!(result.error.is_none());
    assert_eq!(result.items.len(), 2);
    assert_eq!(server.calls.lock().len(), 3);
}

#[tokio::test]
async fn model_errors_preserve_local_candidates_and_only_explicit_format_errors_retry() {
    let _credentials = Credentials::new().await;
    let server = LlmServer::start(vec![
        (500, json!({"error":{"message":"unavailable"}})),
        (200, json!({"choices":[{"message":{"content":"not JSON"}}]})),
        (
            400,
            json!({"error":{"message":"response_format json_object is not supported"}}),
        ),
        (200, json!({"choices":[{"message":{"content":VALID_RANK}}]})),
    ])
    .await;
    let conn = database(&server.base_url);
    let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
    for request in ["http-error", "bad-json"] {
        let result =
            enhance_recommendations(conn.clone(), &provider, &query(), items(), request).await;
        assert!(result.error.is_some());
        assert_eq!(result.items[0].request_id, "local");
    }
    let recovered =
        enhance_recommendations(conn.clone(), &provider, &query(), items(), "compatible").await;
    assert!(recovered.error.is_none());
    let calls = server.calls.lock();
    assert_eq!(calls.len(), 4);
    assert!(calls[2].get("response_format").is_some());
    assert!(calls[3].get("response_format").is_none());
}

#[tokio::test]
async fn incomplete_configuration_never_sends_a_request_and_explains_why() {
    let credentials = Credentials::new().await;
    let conn = database("http://127.0.0.1:1");
    let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
    credentials.clear();
    let no_key =
        enhance_recommendations(conn.clone(), &provider, &query(), items(), "no-key").await;
    assert_eq!(no_key.error.as_deref(), Some("未保存模型 API Key"));
    conn.lock()
        .execute("UPDATE llm_config SET enabled=0", [])
        .unwrap();
    let disabled =
        build_discovery_plan(conn.clone(), &provider, &query(), &items(), "disabled", 4).await;
    assert!(disabled.queries.is_empty());
    assert!(disabled.error.unwrap().contains("未启用"));
    conn.lock().execute_batch("DROP TABLE llm_config").unwrap();
    assert!(
        enhance_recommendations(conn, &provider, &query(), items(), "missing-config")
            .await
            .error
            .is_some()
    );
}

#[tokio::test]
async fn discovery_reports_http_and_json_failures_and_normalizes_valid_search_directions() {
    let _credentials = Credentials::new().await;
    let valid = r#"{"queries":[{"keyword":"  ","source":"all"},{"keyword":"夜晚","source":"kuwo","reason":"  "},{"keyword":"jazz","source":"unsupported"},{"keyword":"extra","source":"qq"}]}"#;
    let server = LlmServer::start(vec![
        (401, json!({"error":{"message":"invalid key"}})),
        (200, json!({"choices":[{"message":{"content":"{}"}}]})),
        (200, json!({"choices":[{"message":{"content":valid}}]})),
    ])
    .await;
    let conn = database(&server.base_url);
    conn.lock()
        .execute("UPDATE llm_config SET upload_recent_events=1", [])
        .unwrap();
    let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
    for request in ["bad-key", "empty"] {
        let result =
            build_discovery_plan(conn.clone(), &provider, &query(), &items(), request, 2).await;
        assert!(result.error.is_some());
        assert!(result.queries.is_empty());
    }
    let result = build_discovery_plan(conn.clone(), &provider, &query(), &items(), "good", 2).await;
    assert!(result.error.is_none());
    assert_eq!(result.queries.len(), 2);
    assert_eq!(result.queries[0].source, "kuwo");
    assert_eq!(result.queries[0].keyword, "夜晚");
    assert_eq!(result.queries[1].source, "all");
    let statuses: String = conn
        .lock()
        .query_row("SELECT group_concat(status) FROM llm_calls", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(
        statuses,
        "discovery_request_failed,discovery_invalid_json,discovery_ok"
    );
}
