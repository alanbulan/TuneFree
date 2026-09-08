use super::*;
use crate::recommendation::{credential_store::test_fixture::Credentials, migration};
use crate::test_support::config_input;

#[tokio::test]
async fn configuration_clamps_values_and_round_trips_isolated_system_credentials() {
    let _credentials = Credentials::new().await;
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    let mut input = config_input(" https://example.test/v1/ ");
    input.model = " test-model ".into();
    input.timeout_ms = Some(100_000);
    input.max_candidates = Some(0);
    input.max_results = Some(100);
    input.cache_ttl_seconds = Some(0);
    input.upload_recent_events = Some(true);
    save_config(&conn, input).unwrap();
    let view = view_config(&conn, 4096, Some("旧请求失败".into())).unwrap();
    assert!(
        view.enabled
            && view.local_recommendation_enabled
            && view.has_api_key
            && view.upload_recent_events
    );
    assert_eq!(view.timeout_ms, 60_000);
    assert_eq!(view.max_candidates, 1);
    assert_eq!(view.max_results, 50);
    assert_eq!(view.cache_ttl_seconds, 60);
    assert_eq!(view.database_size_bytes, 4096);
    assert_eq!(view.last_error.as_deref(), Some("旧请求失败"));
    assert_eq!(view.model, "test-model");
    assert!(view.base_url.starts_with("https://example.test"));
    assert_eq!(get_api_key(&conn).unwrap(), "test-only-key");
    let mut replace = config_input("https://example.test/v1");
    replace.api_key = Some("  replacement-key  ".into());
    save_config(&conn, replace.clone()).unwrap();
    replace.api_key = Some("  ".into());
    save_config(&conn, replace).unwrap();
    assert_eq!(get_api_key(&conn).unwrap(), "replacement-key");
    let plaintext: String = conn
        .query_row("SELECT api_key FROM llm_config WHERE id = 1", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert!(plaintext.is_empty());
    let mut clear = config_input("");
    clear.clear_api_key = Some(true);
    clear.enabled = false;
    clear.local_recommendation_enabled = Some(false);
    save_config(&conn, clear).unwrap();
    assert!(!load_recommendation_enabled(&conn).unwrap());
    assert_eq!(get_api_key(&conn).unwrap(), "");
    assert!(!view_config(&conn, 0, None).unwrap().has_api_key);
    let mut blank = config_input("");
    blank.api_key = Some("  ".into());
    blank.local_recommendation_enabled = None;
    save_config(&conn, blank).unwrap();
    assert_eq!(get_api_key(&conn).unwrap(), "");
}

#[tokio::test]
async fn configuration_errors_are_typed_and_missing_cache_does_not_hide_settings() {
    let _credentials = Credentials::new().await;
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    let error = save_config(&conn, config_input("file:///secret")).unwrap_err();
    assert_eq!(error.code, ErrorCode::LlmConfigInvalid);
    conn.execute_batch("DROP TABLE llm_recommendation_cache")
        .unwrap();
    assert_eq!(view_config(&conn, 0, None).unwrap().llm_cache_entries, 0);
    conn.execute_batch("DROP TABLE recommendation_settings")
        .unwrap();
    assert!(view_config(&conn, 0, None)
        .unwrap_err()
        .contains("推荐开关"));
    assert_eq!(
        save_config(&conn, config_input("")).unwrap_err().code,
        ErrorCode::Database
    );
    conn.execute_batch("DROP TABLE llm_config").unwrap();
    assert!(view_config(&conn, 0, None)
        .unwrap_err()
        .contains("模型配置"));
    assert_eq!(
        save_config(&conn, config_input("")).unwrap_err().code,
        ErrorCode::Database
    );
    assert_eq!(
        credential_error(CredentialStoreError::Unavailable("未安装".into())).code,
        ErrorCode::CredentialUnavailable
    );
    assert_eq!(
        credential_error(CredentialStoreError::Failure("被拒绝".into())).code,
        ErrorCode::Internal
    );
}
