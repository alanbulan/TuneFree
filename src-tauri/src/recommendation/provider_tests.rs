use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use axum::{extract::State, http::StatusCode, Json, Router};
use parking_lot::Mutex;
use serde_json::{json, Value};

use super::{LlmConfig, OpenAiCompatibleProvider};

type Reply = (u16, &'static str, u64);

#[derive(Clone)]
struct MockState {
    calls: Arc<Mutex<Vec<Value>>>,
    replies: Arc<Mutex<VecDeque<Reply>>>,
}

struct MockServer {
    base_url: String,
    state: MockState,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn handler(
    State(state): State<MockState>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    state.calls.lock().push(body);
    let (status, message, delay) = state.replies.lock().pop_front().unwrap_or((200, "", 0));
    tokio::time::sleep(Duration::from_millis(delay)).await;
    let body = if status == 200 {
        json!({"choices": [{"message": {"content": "{\"ok\":true}"}}]})
    } else {
        json!({"error": {"message": message}})
    };
    (StatusCode::from_u16(status).unwrap(), Json(body))
}

async fn server(replies: Vec<Reply>) -> MockServer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let state = MockState {
        calls: Arc::default(),
        replies: Arc::new(Mutex::new(replies.into())),
    };
    let app = Router::new().fallback(handler).with_state(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    MockServer {
        base_url,
        state,
        task,
    }
}

fn config(base_url: &str, timeout_ms: u64) -> LlmConfig {
    LlmConfig {
        enabled: true,
        base_url: base_url.to_string(),
        model: "test-model".to_string(),
        timeout_ms,
        max_candidates: 10,
        max_results: 5,
        cache_ttl_seconds: 60,
        upload_recent_events: false,
    }
}

#[tokio::test]
async fn authentication_rate_limit_and_generic_errors_never_retry() {
    let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
    for (status, message) in [
        (401, "invalid key"),
        (403, "forbidden"),
        (429, "rate limit"),
        (500, "internal error"),
        (400, "max_tokens is required"),
        (404, "model not found"),
    ] {
        let server = server(vec![(status, message, 0)]).await;
        let result = provider
            .test(&config(&server.base_url, 1000), "test-key")
            .await;
        assert!(!result.ok, "HTTP {status} 不应通过兼容重试伪装成成功");
        assert_eq!(
            server.state.calls.lock().len(),
            1,
            "HTTP {status} 只能请求一次"
        );
    }
}

#[tokio::test]
async fn only_explicit_json_format_errors_retry_without_response_format() {
    let server = server(vec![
        (400, "response_format json_object is not supported", 0),
        (200, "", 0),
    ])
    .await;
    let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
    let result = provider
        .test(&config(&server.base_url, 1000), "test-key")
        .await;
    assert!(result.ok);
    assert!(!result.supports_json_object);
    let calls = server.state.calls.lock();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0]["response_format"]["type"], "json_object");
    assert!(calls[1].get("response_format").is_none());
}

#[tokio::test]
async fn a_request_timeout_does_not_trigger_compatibility_retry() {
    let server = server(vec![(200, "", 1000)]).await;
    let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
    let result = provider
        .test(&config(&server.base_url, 100), "test-key")
        .await;
    assert!(!result.ok);
    assert_eq!(server.state.calls.lock().len(), 1);
}

#[tokio::test]
async fn endpoint_and_role_compatibility_share_the_call_deadline() {
    let server = server(vec![
        (404, "route not found", 80),
        (400, "system role is not supported", 80),
        (200, "", 1000),
    ])
    .await;
    let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
    let started = std::time::Instant::now();
    let result = provider
        .chat_json(
            &config(&server.base_url, 300),
            "test-key",
            vec![
                json!({"role": "system", "content": "JSON only"}),
                json!({"role": "user", "content": "test"}),
            ],
            true,
        )
        .await;
    assert!(result.is_err());
    assert!(
        started.elapsed() < Duration::from_millis(430),
        "兼容请求不得重新获得完整时限"
    );
    let calls = server.state.calls.lock();
    assert_eq!(calls.len(), 3);
    assert!(calls[2]["messages"]
        .as_array()
        .unwrap()
        .iter()
        .all(|message| message["role"] != "system"));
}

#[test]
fn full_endpoints_and_system_only_prompts_keep_their_original_meaning() {
    assert_eq!(
        OpenAiCompatibleProvider::chat_completion_urls("https://model.test/v1/chat/completions"),
        ["https://model.test/v1/chat/completions"]
    );
    assert!(OpenAiCompatibleProvider::messages_without_system_role(&[
        json!({"role":"user","content":"问题"})
    ])
    .is_none());
    assert_eq!(
        OpenAiCompatibleProvider::messages_without_system_role(&[
            json!({"role":"system","content":"系统指令"}),
            json!({"role":"assistant","content":"回答"})
        ])
        .unwrap(),
        [
            json!({"role":"user","content":"系统指令"}),
            json!({"role":"assistant","content":"回答"})
        ]
    );
    let error: super::ProviderError = "请求失败".to_string().into();
    assert_eq!(error.to_string(), "请求失败");
    assert!(!error.json_object_unsupported);
}

#[tokio::test]
async fn malformed_and_truncated_response_bodies_are_reported_without_retrying() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    for (body, declared_length, expected) in [
        ("not-json", 8, "不是 JSON"),
        ("{}", 2, "缺少 choices"),
        ("x", 1000, "读取模型响应失败"),
    ] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            assert!(stream.read(&mut request).await.unwrap() > 0);
            let response = format!("HTTP/1.1 200 OK\r\nContent-Length: {declared_length}\r\nConnection: close\r\n\r\n{body}");
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.shutdown().await.unwrap();
        });
        let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
        let result = provider.test(&config(&base, 1000), "test-key").await;
        assert!(!result.ok);
        assert!(result.error.unwrap().contains(expected));
        server.await.unwrap();
    }
}

#[tokio::test]
async fn exhausted_endpoint_and_system_role_compatibility_return_the_last_error() {
    let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
    for replies in [
        vec![(404, "route not found", 0), (404, "route not found", 0)],
        vec![(400, "system role is not supported", 0)],
    ] {
        let expected_calls = replies.len();
        let server = server(replies).await;
        let error = provider
            .chat_json(
                &config(&server.base_url, 1000),
                "test-key",
                vec![json!({"role":"user","content":"test"})],
                true,
            )
            .await
            .unwrap_err();
        assert!(error.message.contains("not found") || error.message.contains("not supported"));
        assert_eq!(server.state.calls.lock().len(), expected_calls);
    }
}
