use super::*;
use axum::http::HeaderValue;

const TEST_TOKEN: &str = "0123456789abcdef0123456789abcdef";
const TEST_PORT: u16 = 43210;

fn request_headers(host: Option<&str>, token: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Some(host) = host {
        headers.insert(HOST, HeaderValue::from_str(host).unwrap());
    }
    if let Some(token) = token {
        headers.insert(LOCAL_TOKEN_HEADER, HeaderValue::from_str(token).unwrap());
    }
    headers
}

#[test]
fn bind_local_listener_binds_random_loopback_port() {
    let listener = bind_local_listener().unwrap();
    let addr = listener.local_addr().unwrap();

    assert!(addr.ip().is_loopback());
    assert_ne!(addr.port(), 0);
}

#[test]
fn bind_local_listener_never_reuses_the_legacy_fixed_port() {
    let first = bind_local_listener().unwrap();
    let second = bind_local_listener().unwrap();

    let first_port = first.local_addr().unwrap().port();
    let second_port = second.local_addr().unwrap().port();
    assert_ne!(first_port, second_port);
    assert_ne!(first_port, 3002);
    assert_ne!(second_port, 3002);
}

#[test]
fn accepts_loopback_host_with_header_token() {
    let headers = request_headers(Some("127.0.0.1:43210"), Some(TEST_TOKEN));

    assert!(validate_local_request(&headers, None, TEST_PORT, TEST_TOKEN).is_ok());
}

#[test]
fn accepts_localhost_host_with_query_token() {
    let headers = request_headers(Some("localhost:43210"), None);
    let query = format!("token={}&url=https%3A%2F%2Fmusic.163.com%2F", TEST_TOKEN);

    assert!(validate_local_request(&headers, Some(&query), TEST_PORT, TEST_TOKEN).is_ok());
}

#[test]
fn rejects_missing_host_header() {
    let headers = request_headers(None, Some(TEST_TOKEN));

    assert_eq!(
        validate_local_request(&headers, None, TEST_PORT, TEST_TOKEN),
        Err(AuthRejection::BadHost)
    );
}

#[test]
fn rejects_foreign_or_mismatched_hosts() {
    for host in [
        "evil.example.com:43210",
        "127.0.0.1:9999",
        "localhost:9999",
        "127.0.0.1",
        "localhost",
    ] {
        let headers = request_headers(Some(host), Some(TEST_TOKEN));

        assert_eq!(
            validate_local_request(&headers, None, TEST_PORT, TEST_TOKEN),
            Err(AuthRejection::BadHost),
            "host {host} should be rejected"
        );
    }
}

#[test]
fn rejects_wrong_or_missing_token() {
    let headers = request_headers(Some("127.0.0.1:43210"), Some("wrong-token"));
    assert_eq!(
        validate_local_request(&headers, None, TEST_PORT, TEST_TOKEN),
        Err(AuthRejection::BadToken)
    );

    let headers = request_headers(Some("127.0.0.1:43210"), None);
    assert_eq!(
        validate_local_request(
            &headers,
            Some("url=https%3A%2F%2Fmusic.163.com%2F"),
            TEST_PORT,
            TEST_TOKEN
        ),
        Err(AuthRejection::BadToken)
    );
}

#[test]
fn query_token_succeeds_even_if_header_token_is_wrong() {
    let headers = request_headers(Some("127.0.0.1:43210"), Some("stale-token"));
    let query = format!("token={TEST_TOKEN}");

    assert!(validate_local_request(&headers, Some(&query), TEST_PORT, TEST_TOKEN).is_ok());
}

#[test]
fn token_prefix_or_extension_is_not_accepted() {
    for candidate in [
        &TEST_TOKEN[..TEST_TOKEN.len() - 1],
        &format!("{TEST_TOKEN}0")[..],
        "",
    ] {
        let headers = request_headers(Some("127.0.0.1:43210"), Some(candidate));
        assert_eq!(
            validate_local_request(&headers, None, TEST_PORT, TEST_TOKEN),
            Err(AuthRejection::BadToken),
            "token {candidate:?} should be rejected"
        );
    }
}

#[test]
fn constant_time_eq_matches_only_identical_bytes() {
    assert!(constant_time_eq(b"abc", b"abc"));
    assert!(constant_time_eq(b"", b""));
    assert!(!constant_time_eq(b"abc", b"abd"));
    assert!(!constant_time_eq(b"abc", b"ab"));
    assert!(!constant_time_eq(b"", b"a"));
}

#[test]
fn query_param_decodes_percent_encoding() {
    assert_eq!(
        query_param("token=ab%2Bcd&url=x", "token").as_deref(),
        Some("ab+cd")
    );
    assert_eq!(query_param("url=x", "token"), None);
    // `<audio src>` puts the token first and the target URL last; a `token`
    // substring inside another parameter must not be mistaken for the token.
    assert_eq!(
        query_param("url=https%3A%2F%2Fx%2F%3Ftoken%3Dz", "token"),
        None
    );
}

#[test]
fn network_errors_never_leak_upstream_details_to_callers() {
    let parse = crate::api::ApiError::Parse("bad payload".to_string());
    assert_eq!(public_error_message(&parse), "Parse error: bad payload");
    assert_eq!(
        public_error_message(&crate::api::ApiError::VipContent),
        "VIP/Copyright protected content"
    );
}

#[tokio::test]
async fn network_error_message_is_generic_and_hides_host_and_port() {
    // 绑定后立即释放，得到一个必定连接失败的地址；reqwest 的错误里会带上它。
    let dead_port = {
        let probe = bind_local_listener().unwrap();
        probe.local_addr().unwrap().port()
    };
    let transport = Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(format!("http://127.0.0.1:{dead_port}/song"))
        .send()
        .await
        .unwrap_err();
    let error = crate::api::ApiError::Network(transport);

    let message = public_error_message(&error);
    assert_eq!(message, "上游音源请求失败");
    assert!(!message.contains(&dead_port.to_string()));
    assert!(!message.contains("127.0.0.1"));
}

#[test]
fn dev_origins_are_debug_only() {
    let origins = allowed_origins();

    assert!(origins.contains(&HeaderValue::from_static("tauri://localhost")));
    assert!(origins.contains(&HeaderValue::from_static("http://tauri.localhost")));
    let has_dev_origin = origins.contains(&HeaderValue::from_static("http://127.0.0.1:3101"));
    assert_eq!(has_dev_origin, cfg!(debug_assertions));
    assert_eq!(origins.len(), if cfg!(debug_assertions) { 4 } else { 2 });
}

/// A running local server plus the handles needed to shut it down again.
struct TestServer {
    port: u16,
    token: String,
    client: Client,
    shutdown: tokio::sync::watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

impl TestServer {
    async fn start() -> Self {
        let listener = bind_local_listener().unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = TEST_TOKEN.to_string();
        // `no_proxy` keeps a developer's HTTP_PROXY environment from
        // intercepting the loopback request under test.
        let client = Client::builder().no_proxy().build().unwrap();
        let state = ServerState {
            api_client: client.clone(),
            proxy_client: client.clone(),
            token: token.clone(),
            port,
        };
        let (shutdown, shutdown_rx) = tokio::sync::watch::channel(false);
        let task = tokio::spawn(start_server(state, listener, shutdown_rx));
        Self {
            port,
            token,
            client,
            shutdown,
            task,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }

    async fn stop(self) {
        let _ = self.shutdown.send(true);
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), self.task).await;
    }
}

#[tokio::test]
async fn health_endpoint_is_exempt_from_host_and_token_checks() {
    let server = TestServer::start().await;

    let response = server
        .client
        .get(server.url("/health"))
        .header(HOST, "evil.example.com")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.text().await.unwrap(), "healthy");

    server.stop().await;
}

#[tokio::test]
async fn protected_route_rejects_missing_and_wrong_tokens() {
    let server = TestServer::start().await;

    let missing = server
        .client
        .get(server.url("/api/allowed-hosts"))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::FORBIDDEN);

    let wrong = server
        .client
        .get(server.url("/api/allowed-hosts"))
        .header(LOCAL_TOKEN_HEADER, "not-the-token")
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), StatusCode::FORBIDDEN);

    let wrong_query = server
        .client
        .get(server.url("/api/allowed-hosts?token=not-the-token"))
        .send()
        .await
        .unwrap();
    assert_eq!(wrong_query.status(), StatusCode::FORBIDDEN);

    server.stop().await;
}

#[tokio::test]
async fn protected_route_rejects_a_foreign_host_header_even_with_a_valid_token() {
    let server = TestServer::start().await;

    let response = server
        .client
        .get(server.url("/api/allowed-hosts"))
        .header(HOST, format!("attacker.example.com:{}", server.port))
        .header(LOCAL_TOKEN_HEADER, &server.token)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    server.stop().await;
}

#[tokio::test]
async fn protected_route_accepts_header_and_query_tokens() {
    let server = TestServer::start().await;

    let via_header = server
        .client
        .get(server.url("/api/allowed-hosts"))
        .header(LOCAL_TOKEN_HEADER, &server.token)
        .send()
        .await
        .unwrap();
    assert_eq!(via_header.status(), StatusCode::OK);
    let hosts: serde_json::Value = via_header.json().await.unwrap();
    assert!(hosts["hosts"]
        .as_array()
        .is_some_and(|list| !list.is_empty()));

    // `<audio src>` cannot set headers, so the query form must work alone.
    let via_query = server
        .client
        .get(server.url(&format!("/api/allowed-hosts?token={}", server.token)))
        .send()
        .await
        .unwrap();
    assert_eq!(via_query.status(), StatusCode::OK);

    server.stop().await;
}

#[tokio::test]
async fn authenticated_url_route_reports_unsupported_platforms() {
    let server = TestServer::start().await;

    let response = server
        .client
        .get(server.url("/api/url?platform=definitely-not-a-platform&id=1"))
        .header(LOCAL_TOKEN_HEADER, &server.token)
        .send()
        .await
        .unwrap();

    // Auth passed (not 403) and dispatch rejected the platform without any
    // upstream network call.
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    server.stop().await;
}
