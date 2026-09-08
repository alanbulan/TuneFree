use super::*;
use axum::{body::to_bytes, extract::Request, Router};
use parking_lot::Mutex;
use std::sync::Arc;

#[tokio::test]
async fn proxy_streams_partial_content_and_limits_forwarded_headers() {
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
                StatusCode::PARTIAL_CONTENT,
                [
                    ("content-range", "bytes 0-3/10"),
                    ("etag", "version-1"),
                    ("set-cookie", "secret=1"),
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
    for (host, referer) in [
        (
            "music-api.gdstudio.xyz",
            "https://music.gdstudio.org/".to_string(),
        ),
        ("i0.hdslb.com", "https://www.bilibili.com/".to_string()),
        ("u.y.qq.com", "https://y.qq.com/".to_string()),
        (
            "music.163.com",
            format!("http://music.163.com:{}", address.port()),
        ),
    ] {
        let client = reqwest::Client::builder()
            .no_proxy()
            .resolve(host, address)
            .build()
            .unwrap();
        let state = ServerState {
            api_client: client.clone(),
            proxy_client: client,
            token: "local-token".into(),
            port: 0,
        };
        let response = handle_cors_proxy(
            State(state),
            Method::POST,
            proxy_request_headers(),
            Query(ProxyQuery {
                url: format!("http://{host}:{}/audio", address.port()),
            }),
            Bytes::from_static(b"data"),
        )
        .await;
        assert_filtered_response(response).await;
        let guard = calls.lock();
        let (method, forwarded) = guard.last().unwrap();
        assert_eq!(method, Method::POST);
        assert_eq!(forwarded["referer"], referer);
        assert_eq!(forwarded["range"], "bytes=0-3");
        assert!(!forwarded.contains_key("cookie"));
        assert!(!forwarded.contains_key("x-tunefree-token"));
        if host.starts_with("music-api") {
            assert_eq!(forwarded["accept"], "application/json,text/plain,*/*");
        }
    }
    assert_eq!(calls.lock().len(), 4);
    server.abort();
}

#[tokio::test]
async fn proxy_rejects_invalid_targets_and_preflight_does_not_contact_upstream() {
    let client = reqwest::Client::new();
    let state = ServerState {
        api_client: client.clone(),
        proxy_client: client,
        token: "token".into(),
        port: 0,
    };
    for (url, expected) in [
        ("not a url", StatusCode::BAD_REQUEST),
        ("file:///secret", StatusCode::BAD_REQUEST),
        ("http://localhost/private", StatusCode::FORBIDDEN),
    ] {
        let response = handle_cors_proxy(
            State(state.clone()),
            Method::GET,
            HeaderMap::new(),
            Query(ProxyQuery { url: url.into() }),
            Bytes::new(),
        )
        .await;
        assert_eq!(response.status(), expected);
    }
    let response = handle_cors_proxy(
        State(state),
        Method::OPTIONS,
        HeaderMap::new(),
        Query(ProxyQuery {
            url: "not a url".into(),
        }),
        Bytes::new(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

fn proxy_request_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    for (name, value) in [
        ("range", "bytes=0-3"),
        ("cookie", "session=secret"),
        ("x-tunefree-token", "local-token"),
    ] {
        headers.insert(
            HeaderName::from_bytes(name.as_bytes()).unwrap(),
            value.parse().unwrap(),
        );
    }
    headers
}

async fn assert_filtered_response(response: axum::response::Response) {
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()["content-range"], "bytes 0-3/10");
    assert_eq!(response.headers()["etag"], "version-1");
    for header in [
        "set-cookie",
        "x-private",
        "connection",
        "access-control-allow-origin",
    ] {
        assert!(!response.headers().contains_key(header));
    }
    assert_eq!(to_bytes(response.into_body(), 4096).await.unwrap(), "data");
}
