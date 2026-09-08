use super::*;
use crate::recommendation::credential_store::{
    self, test_fixture::Credentials, CredentialStoreError,
};
use crate::test_support::TempDir;
use rusqlite::Connection;

#[tokio::test]
async fn native_smoke_never_reads_migrates_overwrites_or_deletes_system_keys() {
    const CHILD_FLAG: &str = "TUNEFREE_CREDENTIAL_ISOLATION_CHILD";
    if std::env::var_os(CHILD_FLAG).is_some() {
        verify_isolated_credentials().await;
        return;
    }
    // SmokeConfig 只初始化一次；独立进程避免改变其他并发测试的运行模式。
    let directory = TempDir::new();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "app::smoke::credential_tests::native_smoke_never_reads_migrates_overwrites_or_deletes_system_keys",
            "--nocapture",
        ])
        .env(CHILD_FLAG, "1")
        .env("TUNEFREE_SMOKE_DIR", &directory.0)
        .env("TUNEFREE_SMOKE_MARKER", directory.0.join("ready.json"))
        .env("TUNEFREE_SMOKE_RUN_ID", "credential-isolation")
        .env("WEBVIEW2_USER_DATA_FOLDER", directory.0.join("webview"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "隔离进程失败: {}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
}

async fn verify_isolated_credentials() {
    let _credentials = Credentials::new().await;
    let conn = Connection::open_in_memory().unwrap();
    crate::recommendation::migration::run_migrations(&conn).unwrap();
    credential_store::save_api_key(&conn, "current-test-sentinel").unwrap();
    let current = keyring::Entry::new(
        &format!("com.alanbulan.tunefree.tests-{}", std::process::id()),
        "llm-api-key-v1",
    )
    .unwrap();
    let legacy = keyring::Entry::new(
        &format!("TuneFree.tests-{}", std::process::id()),
        "openai-compatible-api-key",
    )
    .unwrap();
    legacy.set_password("legacy-test-sentinel").unwrap();
    let mut context: tauri::Context<tauri::test::MockRuntime> =
        tauri::test::mock_context(tauri::test::noop_assets());
    configure(&mut context).unwrap();
    assert!(is_enabled());
    assert_eq!(credential_store::get_api_key(&conn).unwrap(), "");
    assert!(matches!(
        credential_store::save_api_key(&conn, "must-not-overwrite"),
        Err(CredentialStoreError::Unavailable(_))
    ));
    credential_store::delete_api_key(&conn).unwrap();
    assert!(
        !crate::recommendation::llm_config::view_config(&conn, 0, None)
            .unwrap()
            .has_api_key
    );
    // 以下条目属于本测试进程；始终不使用正式 service 标识。
    assert_eq!(current.get_password().unwrap(), "current-test-sentinel");
    assert_eq!(legacy.get_password().unwrap(), "legacy-test-sentinel");
}
