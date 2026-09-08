use super::*;
use axum::{extract::Request, http::StatusCode, response::IntoResponse, Router};
use parking_lot::Mutex;

#[tokio::test]
async fn redirects_follow_allowed_hosts_and_reject_private_targets_and_loops() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let recorded = calls.clone();
    let router = Router::new().fallback(move |request: Request| {
        let recorded = recorded.clone();
        async move {
            let path = request.uri().path();
            recorded.lock().push(path.to_string());
            let target = match path {
                "/follow" => format!("http://music.163.com:{}/audio", address.port()),
                "/forbidden" => format!("http://127.0.0.1:{}/private", address.port()),
                "/loop" => format!("http://music.163.com:{}/loop", address.port()),
                _ => return (StatusCode::OK, "audio").into_response(),
            };
            (StatusCode::FOUND, [("location", target)]).into_response()
        }
    });
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let client = reqwest::Client::builder()
        .no_proxy()
        .resolve("music.163.com", address)
        .redirect(proxy_redirect_policy())
        .build()
        .unwrap();
    let base = format!("http://music.163.com:{}", address.port());
    let audio = client.get(format!("{base}/follow")).send().await.unwrap();
    assert_eq!(audio.text().await.unwrap(), "audio");
    for path in ["forbidden", "loop"] {
        assert!(client
            .get(format!("{base}/{path}"))
            .send()
            .await
            .unwrap_err()
            .is_redirect());
    }
    assert!(!calls.lock().iter().any(|path| path == "/private"));
    assert_eq!(
        calls.lock().iter().filter(|path| *path == "/loop").count(),
        10
    );
    server.abort();
}
