use std::{collections::HashSet, sync::Arc, time::Instant};

use parking_lot::Mutex;
use rusqlite::Connection;
use serde::Deserialize;

use super::*;
use crate::recommendation::{
    model::{RecommendationItem, RecommendationQuery},
    privacy, prompt,
    provider::OpenAiCompatibleProvider,
};

#[derive(Debug, Deserialize)]
struct DiscoveryResponse {
    #[serde(default)]
    queries: Vec<DiscoveryResponseQuery>,
}

#[derive(Debug, Deserialize)]
struct DiscoveryResponseQuery {
    keyword: String,
    source: Option<String>,
    reason: Option<String>,
}

pub async fn build_discovery_plan(
    conn: Arc<Mutex<Connection>>,
    provider: &OpenAiCompatibleProvider,
    query: &RecommendationQuery,
    local_items: &[RecommendationItem],
    request_id: &str,
    limit: usize,
) -> DiscoveryPlanResult {
    let context = match discovery_context(&conn, request_id, local_items.len()) {
        Ok(context) => context,
        Err(result) => return result,
    };
    let local_candidates = local_items
        .iter()
        .take(context.config.max_candidates.min(local_items.len()).max(1))
        .cloned()
        .collect::<Vec<_>>();
    let messages = prompt::build_discovery_messages(
        query,
        &context.profile_tokens,
        &local_candidates,
        limit,
        context
            .config
            .upload_recent_events
            .then_some(context.recent_events.as_slice()),
    );
    let started = Instant::now();
    let content =
        match request_json_with_fallback(provider, &context.config, &context.api_key, messages)
            .await
        {
            Ok(content) => content,
            Err(error) => {
                return discovery_failure(
                    &conn,
                    request_id,
                    &context.config.model,
                    "discovery_request_failed",
                    local_candidates.len(),
                    started,
                    error,
                );
            }
        };
    let Some(queries) = parse_discovery_response(&content, limit).filter(|items| !items.is_empty())
    else {
        return discovery_failure(
            &conn,
            request_id,
            &context.config.model,
            "discovery_invalid_json",
            local_candidates.len(),
            started,
            "模型发现计划格式不正确".to_string(),
        );
    };
    log_discovery_success(
        &conn,
        request_id,
        &context.config.model,
        local_candidates.len(),
        queries.len(),
        started,
    );
    DiscoveryPlanResult {
        queries,
        error: None,
    }
}

fn discovery_context(
    conn: &Arc<Mutex<Connection>>,
    request_id: &str,
    candidate_count: usize,
) -> Result<LlmRequestContext, DiscoveryPlanResult> {
    let guard = conn.lock();
    load_request_context(&guard).map_err(|error| {
        log_llm_call(
            &guard,
            LlmCallLog {
                request_id,
                model: "",
                status: "discovery_context_error",
                latency_ms: None,
                candidate_count,
                result_count: 0,
                error_code: Some(&error),
            },
        );
        DiscoveryPlanResult {
            queries: Vec::new(),
            error: Some(error),
        }
    })
}

fn discovery_failure(
    conn: &Arc<Mutex<Connection>>,
    request_id: &str,
    model: &str,
    status: &str,
    candidate_count: usize,
    started: Instant,
    error: String,
) -> DiscoveryPlanResult {
    log_llm_call(
        &conn.lock(),
        LlmCallLog {
            request_id,
            model,
            status,
            latency_ms: Some(started.elapsed().as_millis() as i64),
            candidate_count,
            result_count: 0,
            error_code: Some(&error),
        },
    );
    DiscoveryPlanResult {
        queries: Vec::new(),
        error: Some(error),
    }
}

fn log_discovery_success(
    conn: &Arc<Mutex<Connection>>,
    request_id: &str,
    model: &str,
    candidate_count: usize,
    result_count: usize,
    started: Instant,
) {
    log_llm_call(
        &conn.lock(),
        LlmCallLog {
            request_id,
            model,
            status: "discovery_ok",
            latency_ms: Some(started.elapsed().as_millis() as i64),
            candidate_count,
            result_count,
            error_code: None,
        },
    );
}

fn parse_discovery_response(content: &str, limit: usize) -> Option<Vec<DiscoverySearchQuery>> {
    let parsed: DiscoveryResponse = serde_json::from_str(content.trim()).ok()?;
    let mut queries = Vec::new();
    let mut seen = HashSet::new();
    for item in parsed.queries {
        let keyword = item.keyword.trim();
        if keyword.is_empty() {
            continue;
        }
        let source = match item.source.as_deref().unwrap_or("all").trim() {
            "netease" => "netease",
            "qq" | "tencent" => "qq",
            "kuwo" => "kuwo",
            _ => "all",
        };
        let key = format!("{}:{}", source, catalog::normalize_text(keyword));
        if !seen.insert(key) {
            continue;
        }
        queries.push(DiscoverySearchQuery {
            keyword: privacy::short_reason(keyword),
            source: source.to_string(),
            reason: item
                .reason
                .as_deref()
                .and_then(|reason| prompt::item_reason(Some(reason)))
                .unwrap_or_else(|| "云端扩展发现".to_string()),
        });
        if queries.len() >= limit {
            break;
        }
    }
    Some(queries)
}
