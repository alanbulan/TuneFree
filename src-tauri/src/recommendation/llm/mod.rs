mod cache;
mod discovery_plan;
mod json;
mod rerank;
mod response;

#[cfg(all(test, windows))]
#[path = "__tests__/pipeline.rs"]
mod pipeline_tests;

pub use discovery_plan::build_discovery_plan;
pub use json::{extract_json, response_sample};
pub use rerank::enhance_recommendations;

use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use super::{
    catalog, events, llm_config,
    model::{LlmConfig, ProfileToken, RecentEventSummary, RecommendationItem},
    privacy, profile,
    provider::OpenAiCompatibleProvider,
};

#[derive(Debug, Clone)]
pub struct DiscoverySearchQuery {
    pub keyword: String,
    pub source: String,
    pub reason: String,
}

pub struct DiscoveryPlanResult {
    pub queries: Vec<DiscoverySearchQuery>,
    pub error: Option<String>,
}

pub struct LlmEnhancementResult {
    pub items: Vec<RecommendationItem>,
    pub error: Option<String>,
}

impl LlmEnhancementResult {
    pub(super) fn ok(items: Vec<RecommendationItem>) -> Self {
        Self { items, error: None }
    }

    pub(super) fn failed(items: Vec<RecommendationItem>, error: String) -> Self {
        Self {
            items,
            error: Some(error),
        }
    }
}

pub(super) fn can_call_llm(config: &super::model::LlmConfig) -> bool {
    !crate::app::is_smoke_test()
        && config.enabled
        && !config.base_url.trim().is_empty()
        && !config.model.trim().is_empty()
}

pub(super) struct LlmRequestContext {
    pub config: LlmConfig,
    pub api_key: String,
    pub profile_tokens: Vec<ProfileToken>,
    pub recent_events: Vec<RecentEventSummary>,
}

pub(super) fn load_request_context(conn: &Connection) -> Result<LlmRequestContext, String> {
    let config = llm_config::load_config(conn).map_err(|error| error.to_string())?;
    if !can_call_llm(&config) {
        return Err("云端推荐未启用或配置不完整".to_string());
    }
    let api_key = llm_config::get_api_key(conn)?;
    if api_key.trim().is_empty() {
        return Err("未保存模型 API Key".to_string());
    }
    let profile_tokens = profile::top_profile_tokens(conn, 30).unwrap_or_else(|error| {
        log::warn!("读取推荐画像失败，云端推荐降级为空画像: {}", error);
        Vec::new()
    });
    let recent_events = if config.upload_recent_events {
        events::recent_event_summaries(conn, 20).unwrap_or_else(|error| {
            log::warn!("读取近期推荐事件失败，云端推荐降级为不上传事件: {}", error);
            Vec::new()
        })
    } else {
        Vec::new()
    };
    Ok(LlmRequestContext {
        config,
        api_key,
        profile_tokens,
        recent_events,
    })
}

pub(super) async fn request_json_with_fallback(
    provider: &OpenAiCompatibleProvider,
    config: &LlmConfig,
    api_key: &str,
    messages: Vec<Value>,
) -> Result<String, String> {
    match provider
        .chat_json(config, api_key, messages.clone(), true)
        .await
    {
        Ok(content) => Ok(content),
        Err(error) if error.json_object_unsupported => provider
            .chat_json(config, api_key, messages, false)
            .await
            .map_err(|error| error.message),
        Err(error) => Err(error.message),
    }
}

pub(super) struct LlmCallLog<'a> {
    pub request_id: &'a str,
    pub model: &'a str,
    pub status: &'a str,
    pub latency_ms: Option<i64>,
    pub candidate_count: usize,
    pub result_count: usize,
    pub error_code: Option<&'a str>,
}

pub(super) fn log_llm_call(conn: &Connection, call: LlmCallLog<'_>) {
    let result = conn.execute(
        r#"
        INSERT INTO llm_calls (
          request_id, model, status, latency_ms, candidate_count, result_count, error_code, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            call.request_id, call.model, call.status, call.latency_ms,
            call.candidate_count as i64, call.result_count as i64,
            call.error_code.map(privacy::short_reason), catalog::now_ms(),
        ],
    );
    if let Err(error) = result {
        log::warn!("写入模型调用日志失败: {}", error);
    }
}

struct CancelBlockingOnDrop(Arc<AtomicBool>);

impl Drop for CancelBlockingOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

/// 等待数据库锁的后台操作在调用方取消后不再执行；已持锁的写入先于 clear 完成。
pub(super) async fn run_llm_blocking<T, F>(
    conn: Arc<Mutex<Connection>>,
    operation: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> T + Send + 'static,
{
    let cancelled = Arc::new(AtomicBool::new(false));
    let _lifetime = CancelBlockingOnDrop(Arc::clone(&cancelled));
    crate::app::run_recommendation_blocking(move || {
        let conn = conn.lock();
        if cancelled.load(Ordering::Acquire) {
            return Err(crate::app::error::CommandError::cancelled(
                "模型后台任务已取消",
            ));
        }
        Ok(operation(&conn))
    })
    .await
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod blocking_tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_while_waiting_for_database_lock_prevents_late_writes() {
        let conn = Arc::new(Mutex::new(Connection::open_in_memory().unwrap()));
        let (sent, received) = tokio::sync::oneshot::channel();
        {
            let _guard = conn.lock();
            let pending = run_llm_blocking(Arc::clone(&conn), move |db| {
                db.execute_batch("CREATE TABLE stale_result (value TEXT)")
                    .unwrap();
                let _ = sent.send(());
            });
            let mut pending = std::pin::pin!(pending);
            // 先轮询后台 future，使操作入队，再模拟外层取消并丢弃 future。
            let mut context = std::task::Context::from_waker(std::task::Waker::noop());
            assert!(std::future::Future::poll(pending.as_mut(), &mut context).is_pending());
        }
        assert!(received.await.is_err(), "取消后不应运行写入闭包");
        let count: i64 = conn
            .lock()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'stale_result'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}
