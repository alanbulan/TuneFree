use super::*;
use axum::{http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use parking_lot::Mutex;
use serde_json::json;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tauri::Listener;

fn application(endpoint: Option<&str>) -> tauri::App {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = format!(
        "com.alanbulan.tunefree.updater-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    context.config_mut().plugins.0.insert(
        "updater".into(),
        json!({
            "endpoints": endpoint.into_iter().collect::<Vec<_>>(),
            "pubkey": include_str!("fixtures/update-test.pub").trim(),
            "dangerousInsecureTransportProtocol": true
        }),
    );
    tauri::Builder::default()
        .any_thread()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap()
}

#[tokio::test]
async fn missing_update_endpoints_return_initialization_errors() {
    let app = application(None);
    let check = check_for_update(app.handle().clone()).await.err().unwrap();
    let install = download_and_install_update(app.handle().clone())
        .await
        .unwrap_err();
    for error in [check, install] {
        assert_eq!(error.code, ErrorCode::UpdateFailed);
        assert_eq!(error.message, "初始化更新器失败");
    }
}

#[tokio::test]
async fn empty_or_malformed_manifests_return_no_update_or_a_typed_error() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new()
        .route("/none", get(|| async { StatusCode::NO_CONTENT }))
        .route("/invalid", get(|| async { "not a manifest" }));
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let app = application(Some(&format!("{base}/none")));
    assert!(check_for_update(app.handle().clone())
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        download_and_install_update(app.handle().clone())
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    let invalid = application(Some(&format!("{base}/invalid")));
    assert_eq!(
        check_for_update(invalid.handle().clone())
            .await
            .err()
            .unwrap()
            .message,
        "检查更新失败"
    );
    assert_eq!(
        download_and_install_update(invalid.handle().clone())
            .await
            .unwrap_err()
            .message,
        "检查更新失败"
    );
    server.abort();
}

#[tokio::test]
async fn update_metadata_and_download_progress_are_reported_but_bad_signatures_never_install() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let manifest = json!({
        "version":"999.0.0", "notes":"隔离更新测试", "pub_date":"2026-09-08T00:00:00Z",
        "platforms":{"windows-x86_64":{
            "url":format!("{base}/package"), "signature":"invalid-test-signature"
        }}
    });
    let downloads = Arc::new(AtomicU64::new(0));
    let recorded = downloads.clone();
    let router = Router::new()
        .route(
            "/manifest",
            get(move || {
                let manifest = manifest.clone();
                async move { Json(manifest) }
            }),
        )
        .route(
            "/package",
            get(move || {
                recorded.fetch_add(1, Ordering::SeqCst);
                async { (StatusCode::OK, "unsigned test payload").into_response() }
            }),
        );
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let app = application(Some(&format!("{base}/manifest")));
    let update = check_for_update(app.handle().clone())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(update.version, "999.0.0");
    assert_eq!(update.notes.as_deref(), Some("隔离更新测试"));
    let progress = Arc::new(Mutex::new(Vec::<u64>::new()));
    let observed = progress.clone();
    let subscription = app.listen("update-progress", move |event| {
        let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
        observed.lock().push(payload["progress"].as_u64().unwrap());
    });
    let error = download_and_install_update(app.handle().clone())
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::UpdateFailed);
    assert_eq!(error.message, "下载或安装更新失败");
    assert_eq!(downloads.load(Ordering::SeqCst), 1);
    assert_eq!(progress.lock().first(), Some(&0));
    assert!(progress.lock().contains(&99));
    assert!(progress.lock().iter().all(|value| *value < 100));
    app.unlisten(subscription);
    server.abort();
}

#[tokio::test]
async fn verified_download_reaches_full_progress_before_rejecting_an_invalid_installer() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let manifest = json!({
        "version":"999.0.0", "pub_date":"2026-09-08T00:00:00Z",
        "platforms":{"windows-x86_64":{
            "url":format!("{base}/package"),
            "signature":include_str!("fixtures/invalid-update.bin.sig").trim()
        }}
    });
    let router = Router::new()
        .route(
            "/manifest",
            get(move || {
                let manifest = manifest.clone();
                async move { Json(manifest) }
            }),
        )
        .route(
            "/package",
            get(|| async { include_bytes!("fixtures/invalid-update.bin").as_slice() }),
        );
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let app = application(Some(&format!("{base}/manifest")));
    let progress = Arc::new(Mutex::new(Vec::<u64>::new()));
    let observed = progress.clone();
    let subscription = app.listen("update-progress", move |event| {
        let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
        observed.lock().push(payload["progress"].as_u64().unwrap());
    });
    // 随附数据经过测试公钥签名，但没有 EXE/MSI/ZIP 文件头；
    // 官方插件会在创建安装文件和启动进程之前拒绝它。
    let error = download_and_install_update(app.handle().clone())
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::UpdateFailed);
    assert_eq!(progress.lock().first(), Some(&0));
    assert_eq!(progress.lock().last(), Some(&100));
    assert!(progress.lock().windows(2).all(|pair| pair[0] <= pair[1]));
    app.unlisten(subscription);
    server.abort();
}
