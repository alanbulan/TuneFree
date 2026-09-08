#[cfg(windows)]
use axum::{extract::State, http::StatusCode, Json, Router};
#[cfg(windows)]
use parking_lot::Mutex;
#[cfg(windows)]
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(windows)]
use std::{collections::VecDeque, sync::Arc};

#[cfg(windows)]
#[path = "https.rs"]
pub(crate) mod https;

/// 使用真实 Wry 运行时与空窗口配置。测试只持有应用句柄，不创建用户主窗口。
#[cfg(windows)]
pub(crate) fn app() -> tauri::App {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = format!(
        "com.alanbulan.tunefree.test-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    tauri::Builder::default()
        .any_thread()
        .build(context)
        .expect("创建隔离的 Tauri 测试应用")
}

pub(crate) fn config_input(base_url: &str) -> crate::recommendation::model::LlmConfigInput {
    crate::recommendation::model::LlmConfigInput {
        local_recommendation_enabled: Some(true),
        enabled: true,
        base_url: base_url.into(),
        model: "test-model".into(),
        timeout_ms: Some(1000),
        max_candidates: Some(8),
        max_results: Some(3),
        cache_ttl_seconds: Some(60),
        upload_recent_events: Some(false),
        api_key: Some("test-only-key".into()),
        clear_api_key: Some(false),
    }
}

#[derive(Clone)]
#[cfg(windows)]
struct ServerState {
    calls: Arc<Mutex<Vec<Value>>>,
    replies: Arc<Mutex<VecDeque<(StatusCode, Value)>>>,
}

#[cfg(windows)]
pub(crate) struct LlmServer {
    pub(crate) base_url: String,
    pub(crate) calls: Arc<Mutex<Vec<Value>>>,
    task: tokio::task::JoinHandle<()>,
}

#[cfg(windows)]
impl LlmServer {
    pub(crate) async fn start(replies: Vec<(u16, Value)>) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let state = ServerState {
            calls: Arc::default(),
            replies: Arc::new(Mutex::new(
                replies
                    .into_iter()
                    .map(|(status, body)| (StatusCode::from_u16(status).unwrap(), body))
                    .collect(),
            )),
        };
        let calls = state.calls.clone();
        let task = tokio::spawn(async move {
            axum::serve(listener, Router::new().fallback(reply).with_state(state))
                .await
                .unwrap();
        });
        Self {
            base_url,
            calls,
            task,
        }
    }

    pub(crate) async fn contents(contents: &[&str]) -> Self {
        Self::start(
            contents
                .iter()
                .map(|content| (200, json!({"choices":[{"message":{"content":content}}]})))
                .collect(),
        )
        .await
    }
}

#[cfg(windows)]
async fn reply(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    state.calls.lock().push(body);
    let (status, response) = state
        .replies
        .lock()
        .pop_front()
        .expect("模型请求次数超出测试约定");
    (status, Json(response))
}

#[cfg(windows)]
impl Drop for LlmServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(crate) struct TempDir(pub(crate) std::path::PathBuf);

impl TempDir {
    pub(crate) fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "tunefree-isolated-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        assert!(self.0.starts_with(std::env::temp_dir()));
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("tunefree-isolated-"));
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
