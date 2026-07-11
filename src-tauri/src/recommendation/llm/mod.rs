mod cache;
mod discovery_plan;
mod rerank;
mod response;

pub use discovery_plan::build_discovery_plan;
pub use rerank::enhance_recommendations;

use rusqlite::{params, Connection};
use serde_json::Value;

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
    config.enabled && !config.base_url.trim().is_empty() && !config.model.trim().is_empty()
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
        Err(_) => provider.chat_json(config, api_key, messages, false).await,
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
