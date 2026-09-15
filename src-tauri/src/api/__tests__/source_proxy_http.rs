use super::*;
use axum::{body::to_bytes, extract::Request, Router};
use parking_lot::Mutex;
use std::sync::Arc;

/// 构造一个把 `source.test` 解析到本地假上游的客户端。
fn resolved_client(address: std::net::SocketAddr) -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .resolve("source.test", address)
        .build()
        .unwrap()
}

fn state_with(client: reqwest::Client) -> ServerState {
    ServerState {
        api_client: client.clone(),
        proxy_client: client.clone(),
        source_proxy_client: client,
        token: "local-token".into(),
        port: 0,
    }
}

fn headers_from(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect()
}

async fn envelope(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn source_proxy_forwards_script_headers_and_wraps_response() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let recorded = calls.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = Router::new().fallback(move |request: Request| {
        let recorded = recorded.clone();
        async move {
            let (parts, body) = request.into_parts();
            recorded.lock().push((parts.method, parts.headers));
            let body = to_bytes(body, 4096).await.unwrap();
            (
                StatusCode::OK,
                [
                    ("content-type", "application/json"),
                    ("set-cookie", "session=abc; Path=/"),
                    ("connection", "x-private"),
                    ("x-private", "hidden"),
                    ("access-control-allow-origin", "https://upstream.test"),
                ],
                body,
            )
                .into_response()
        }
    });
    let server = tokio::spawn(async move {
        axum::serve(listener, upstream).await.unwrap();
    });

    let state = state_with(resolved_client(address));
    let payload = SourceProxyRequest {
        url: format!("http://source.test:{}/lx/api/url?source=wy", address.port()),
        method: Some("post".into()),
        headers: headers_from(&[
            ("user-agent", "lx-music-desktop"),
            ("referer", "https://y.qq.com/"),
            ("cookie", "a=1"),
            ("accept-encoding", "gzip"),
            (LOCAL_TOKEN_HEADER, "local-token"),
        ]),
        body_base64: Some(BASE64_STANDARD.encode("songmid=123&quality=320k")),
        timeout_ms: Some(5_000),
    };
    let response = handle_source_proxy(State(state), Json(payload)).await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = envelope(response).await;
    assert_eq!(body["status"], 200);
    assert_eq!(body["statusText"], "OK");
    assert_eq!(body["headers"]["content-type"], "application/json");
    assert_eq!(body["headers"].get("set-cookie"), None);
    assert_eq!(body["headers"].get("x-private"), None);
    assert_eq!(body["headers"].get("access-control-allow-origin"), None);
    assert_eq!(body["cookies"][0], "session=abc; Path=/");
    let decoded = BASE64_STANDARD
        .decode(body["bodyBase64"].as_str().unwrap())
        .unwrap();
    assert_eq!(decoded, b"songmid=123&quality=320k");

    let guard = calls.lock();
    let (method, forwarded) = guard.last().unwrap();
    assert_eq!(method, Method::POST);
    assert_eq!(forwarded["user-agent"], "lx-music-desktop");
    assert_eq!(forwarded["referer"], "https://y.qq.com/");
    assert_eq!(forwarded["cookie"], "a=1");
    assert!(!forwarded.contains_key("accept-encoding"));
    assert!(!forwarded.contains_key(LOCAL_TOKEN_HEADER));
    assert_eq!(
        forwarded["host"],
        format!("source.test:{}", address.port()).as_str()
    );
    drop(guard);
    server.abort();
}

#[tokio::test]
async fn source_proxy_rejects_unsafe_or_malformed_requests() {
    let client = reqwest::Client::new();
    let cases: [(SourceProxyRequest, StatusCode); 5] = [
        (
            SourceProxyRequest {
                url: "not a url".into(),
                method: None,
                headers: BTreeMap::new(),
                body_base64: None,
                timeout_ms: None,
            },
            StatusCode::BAD_REQUEST,
        ),
        (
            SourceProxyRequest {
                url: "http://127.0.0.1:3002/api/url".into(),
                method: None,
                headers: BTreeMap::new(),
                body_base64: None,
                timeout_ms: None,
            },
            StatusCode::FORBIDDEN,
        ),
        (
            SourceProxyRequest {
                url: "http://localhost/private".into(),
                method: None,
                headers: BTreeMap::new(),
                body_base64: None,
                timeout_ms: None,
            },
            StatusCode::FORBIDDEN,
        ),
        (
            SourceProxyRequest {
                url: "https://example.test/x".into(),
                method: Some("TRACE".into()),
                headers: BTreeMap::new(),
                body_base64: None,
                timeout_ms: None,
            },
            StatusCode::BAD_REQUEST,
        ),
        (
            SourceProxyRequest {
                url: "https://example.test/x".into(),
                method: Some("POST".into()),
                headers: BTreeMap::new(),
                body_base64: Some("这不是 base64".into()),
                timeout_ms: None,
            },
            StatusCode::BAD_REQUEST,
        ),
    ];

    for (payload, expected) in cases {
        let response = handle_source_proxy(State(state_with(client.clone())), Json(payload)).await;
        assert_eq!(response.status(), expected);
        let body = envelope(response).await;
        assert!(body["error"].as_str().is_some_and(|text| !text.is_empty()));
    }
}

#[tokio::test]
async fn source_proxy_reports_upstream_failures_as_gateway_errors() {
    // 目标可解析但连不上（本机 1 端口），断言错误被归类为网关错误，
    // 且不把 reqwest 的地址细节透给沙箱。
    let unreachable: std::net::SocketAddr = "127.0.0.1:1".parse().unwrap();
    let state = state_with(resolved_client(unreachable));
    let payload = SourceProxyRequest {
        url: "http://source.test/unreachable".into(),
        method: None,
        headers: BTreeMap::new(),
        body_base64: None,
        timeout_ms: Some(1_500),
    };
    let response = handle_source_proxy(State(state), Json(payload)).await;
    // 连接失败或超时都算网关错误；重点是不能把上游细节透给沙箱。
    assert!(
        matches!(
            response.status(),
            StatusCode::BAD_GATEWAY | StatusCode::GATEWAY_TIMEOUT
        ),
        "意外状态码：{}",
        response.status()
    );
    let body = envelope(response).await;
    let text = body["error"].as_str().unwrap();
    assert!(
        !text.contains("127.0.0.1"),
        "错误信息不应包含上游地址：{text}"
    );
}

#[tokio::test]
async fn source_proxy_uses_get_by_default_and_skips_body_for_get() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let recorded = calls.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = Router::new().fallback(move |request: Request| {
        let recorded = recorded.clone();
        async move {
            let (parts, body) = request.into_parts();
            recorded.lock().push((parts.method, parts.headers));
            let body = to_bytes(body, 1024).await.unwrap();
            (StatusCode::OK, body).into_response()
        }
    });
    let server = tokio::spawn(async move {
        axum::serve(listener, upstream).await.unwrap();
    });

    let state = state_with(resolved_client(address));
    let payload = SourceProxyRequest {
        url: format!("http://source.test:{}/plain.txt", address.port()),
        method: None,
        headers: headers_from(&[
            ("x-bad header", "1"),
            ("x-good", "2"),
            ("host", "evil.test"),
            ("content-length", "999"),
            ("te", "trailers"),
        ]),
        body_base64: Some(BASE64_STANDARD.encode("ignored")),
        timeout_ms: None,
    };
    let response = handle_source_proxy(State(state), Json(payload)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = envelope(response).await;
    assert_eq!(body["status"], 200);
    assert!(body["headers"]["content-type"].as_str().is_some());

    let guard = calls.lock();
    let (method, forwarded) = guard.last().unwrap();
    assert_eq!(method, Method::GET);
    assert_eq!(forwarded["x-good"], "2");
    assert_eq!(
        forwarded["host"],
        format!("source.test:{}", address.port()).as_str()
    );
    assert!(!forwarded.contains_key("x-bad header"));
    assert!(!forwarded.contains_key("content-length"));
    assert!(!forwarded.contains_key("te"));
    drop(guard);
    server.abort();
}

#[tokio::test]
async fn source_proxy_timeout_includes_reading_the_body() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 4096];
        assert!(stream.read(&mut buffer).await.unwrap() > 0);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\na")
            .await
            .unwrap();
        std::future::pending::<()>().await;
    });
    let request = SourceProxyRequest {
        url: format!("http://source.test:{}/slow-body", address.port()),
        method: None,
        headers: BTreeMap::new(),
        body_base64: None,
        timeout_ms: Some(500),
    };
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        handle_source_proxy(State(state_with(resolved_client(address))), Json(request)),
    )
    .await;
    server.abort();
    assert_eq!(
        response.expect("响应体也必须遵守请求时限").status(),
        StatusCode::GATEWAY_TIMEOUT
    );
}
