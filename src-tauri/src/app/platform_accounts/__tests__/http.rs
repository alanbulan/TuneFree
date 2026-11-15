use super::*;
use crate::app::error::ErrorCode;

#[test]
fn recognizes_real_anonymous_account_responses_without_reporting_login_success() {
    let value = serde_json::json!({"code":0,"req":{"code":1000}});
    assert_eq!(qq_data(value).unwrap_err().code, ErrorCode::AuthRequired);
    assert_eq!(
        check_netease(&serde_json::json!({"code":301}))
            .unwrap_err()
            .code,
        ErrorCode::AuthRequired
    );
    assert!(check_netease(&serde_json::json!({"code":200})).is_ok());
    assert!(qq_data(
        serde_json::json!({"code":0,"req":{"code":0,"data":{"info":{"nick":"fixture"}}}})
    )
    .is_ok());
    assert!(qq_data(serde_json::json!({"code":0,"req":{"code":0}})).is_err());
}

#[tokio::test]
async fn platform_client_does_not_forward_sessions_on_redirect() {
    use axum::{routing::get, Router};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let app = Router::new()
        .route(
            "/start",
            get(|| async { axum::response::Redirect::temporary("/target") }),
        )
        .route(
            "/target",
            get(move || {
                seen.fetch_add(1, Ordering::SeqCst);
                async { "unexpected" }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let response = client()
        .get(format!("http://{address}/start"))
        .header("Cookie", "MUSIC_U=fixture")
        .send()
        .await
        .unwrap();
    assert!(response.status().is_redirection());
    assert!(read_response(response).await.is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    task.abort();
}
