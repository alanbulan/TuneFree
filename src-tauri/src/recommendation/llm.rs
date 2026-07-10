use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Instant,
};

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use super::{
    catalog, events, llm_config,
    model::{LlmConfig, RecommendationItem, RecommendationQuery},
    privacy, prompt,
    provider::OpenAiCompatibleProvider,
    rerank,
};

#[derive(Debug, Deserialize)]
struct LlmResponse {
    #[serde(default)]
    items: Vec<LlmResponseItem>,
}

#[derive(Debug, Deserialize)]
struct LlmResponseItem {
    track_key: String,
    rank: Option<usize>,
    score: Option<f64>,
    reason: Option<String>,
}

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
    fn ok(items: Vec<RecommendationItem>) -> Self {
        Self { items, error: None }
    }

    fn failed(items: Vec<RecommendationItem>, error: String) -> Self {
        Self {
            items,
            error: Some(error),
        }
    }
}

pub async fn build_discovery_plan(
    conn: Arc<Mutex<Connection>>,
    provider: &OpenAiCompatibleProvider,
    query: &RecommendationQuery,
    local_items: &[RecommendationItem],
    request_id: &str,
    limit: usize,
) -> DiscoveryPlanResult {
    let (config, api_key, profile_tokens, recent_events) = {
        let guard = conn.lock();
        let config = match llm_config::load_config(&guard) {
            Ok(config) => config,
            Err(e) => {
                let error = e.to_string();
                log_llm_call(
                    &guard,
                    LlmCallLog {
                        request_id,
                        model: "",
                        status: "discovery_config_error",
                        latency_ms: None,
                        candidate_count: local_items.len(),
                        result_count: 0,
                        error_code: Some(&error),
                    },
                );
                return DiscoveryPlanResult {
                    queries: Vec::new(),
                    error: Some(error),
                };
            }
        };

        if !can_call_llm(&config) {
            return DiscoveryPlanResult {
                queries: Vec::new(),
                error: Some("云端发现未启用或配置不完整".to_string()),
            };
        }

        let api_key = match llm_config::get_api_key(&guard) {
            Ok(key) if !key.trim().is_empty() => key,
            Ok(_) => {
                return DiscoveryPlanResult {
                    queries: Vec::new(),
                    error: Some("未保存模型 API Key".to_string()),
                }
            }
            Err(e) => {
                log_llm_call(
                    &guard,
                    LlmCallLog {
                        request_id,
                        model: &config.model,
                        status: "discovery_key_error",
                        latency_ms: None,
                        candidate_count: local_items.len(),
                        result_count: 0,
                        error_code: Some(&e),
                    },
                );
                return DiscoveryPlanResult {
                    queries: Vec::new(),
                    error: Some(e),
                };
            }
        };
        let profile_tokens = super::profile::top_profile_tokens(&guard, 30).unwrap_or_default();
        let recent_events = if config.upload_recent_events {
            events::recent_event_summaries(&guard, 20).unwrap_or_default()
        } else {
            Vec::new()
        };
        (config, api_key, profile_tokens, recent_events)
    };

    let local_candidates: Vec<_> = local_items
        .iter()
        .take(config.max_candidates.min(local_items.len()).max(1))
        .cloned()
        .collect();
    let messages = prompt::build_discovery_messages(
        query,
        &profile_tokens,
        &local_candidates,
        limit,
        config
            .upload_recent_events
            .then_some(recent_events.as_slice()),
    );
    let started = Instant::now();
    let first_attempt = provider
        .chat_json(&config, &api_key, messages.clone(), true)
        .await;
    let content = match first_attempt {
        Ok(content) => content,
        Err(_) => match provider.chat_json(&config, &api_key, messages, false).await {
            Ok(content) => content,
            Err(e) => {
                let guard = conn.lock();
                log_llm_call(
                    &guard,
                    LlmCallLog {
                        request_id,
                        model: &config.model,
                        status: "discovery_request_failed",
                        latency_ms: Some(started.elapsed().as_millis() as i64),
                        candidate_count: local_candidates.len(),
                        result_count: 0,
                        error_code: Some(&e),
                    },
                );
                return DiscoveryPlanResult {
                    queries: Vec::new(),
                    error: Some(e),
                };
            }
        },
    };

    let parsed = match parse_discovery_response(&content, limit) {
        Some(queries) if !queries.is_empty() => queries,
        _ => {
            let guard = conn.lock();
            log_llm_call(
                &guard,
                LlmCallLog {
                    request_id,
                    model: &config.model,
                    status: "discovery_invalid_json",
                    latency_ms: Some(started.elapsed().as_millis() as i64),
                    candidate_count: local_candidates.len(),
                    result_count: 0,
                    error_code: None,
                },
            );
            return DiscoveryPlanResult {
                queries: Vec::new(),
                error: Some("模型发现计划格式不正确".to_string()),
            };
        }
    };

    let guard = conn.lock();
    log_llm_call(
        &guard,
        LlmCallLog {
            request_id,
            model: &config.model,
            status: "discovery_ok",
            latency_ms: Some(started.elapsed().as_millis() as i64),
            candidate_count: local_candidates.len(),
            result_count: parsed.len(),
            error_code: None,
        },
    );
    DiscoveryPlanResult {
        queries: parsed,
        error: None,
    }
}

pub async fn enhance_recommendations(
    conn: Arc<Mutex<Connection>>,
    provider: &OpenAiCompatibleProvider,
    query: &RecommendationQuery,
    local_items: Vec<RecommendationItem>,
    request_id: &str,
) -> LlmEnhancementResult {
    let (config, api_key, profile_tokens, recent_events) = {
        let guard = conn.lock();
        let config = match llm_config::load_config(&guard) {
            Ok(config) => config,
            Err(e) => {
                let error = e.to_string();
                log_llm_call(
                    &guard,
                    LlmCallLog {
                        request_id,
                        model: "",
                        status: "config_error",
                        latency_ms: None,
                        candidate_count: local_items.len(),
                        result_count: 0,
                        error_code: Some(&error),
                    },
                );
                return LlmEnhancementResult::failed(local_items, error);
            }
        };

        if !can_call_llm(&config) {
            return LlmEnhancementResult::failed(
                local_items,
                "云端重排未启用或配置不完整".to_string(),
            );
        }

        let api_key = match llm_config::get_api_key(&guard) {
            Ok(key) if !key.trim().is_empty() => key,
            Ok(_) => {
                return LlmEnhancementResult::failed(local_items, "未保存模型 API Key".to_string())
            }
            Err(e) => {
                log_llm_call(
                    &guard,
                    LlmCallLog {
                        request_id,
                        model: &config.model,
                        status: "key_error",
                        latency_ms: None,
                        candidate_count: local_items.len(),
                        result_count: 0,
                        error_code: Some(&e),
                    },
                );
                return LlmEnhancementResult::failed(local_items, e);
            }
        };

        let profile_tokens = super::profile::top_profile_tokens(&guard, 30).unwrap_or_default();
        let recent_events = if config.upload_recent_events {
            events::recent_event_summaries(&guard, 20).unwrap_or_default()
        } else {
            Vec::new()
        };
        (config, api_key, profile_tokens, recent_events)
    };

    let max_candidates = config.max_candidates.min(local_items.len()).max(1);
    let max_results = config
        .max_results
        .min(query.limit.unwrap_or(30))
        .min(local_items.len())
        .max(1);
    let candidates: Vec<_> = local_items.iter().take(max_candidates).cloned().collect();
    let messages = prompt::build_messages(
        query,
        &profile_tokens,
        &candidates,
        max_results,
        config
            .upload_recent_events
            .then_some(recent_events.as_slice()),
    );
    let cache_key = cache_key(&config, &messages, max_results);
    let cached_content = {
        let guard = conn.lock();
        load_cache(&guard, &cache_key).ok().flatten()
    };

    if let Some(content) = cached_content {
        if let Some(items) =
            apply_llm_response(&content, local_items.clone(), max_results, request_id)
        {
            let guard = conn.lock();
            log_llm_call(
                &guard,
                LlmCallLog {
                    request_id,
                    model: &config.model,
                    status: "cache_hit",
                    latency_ms: Some(0),
                    candidate_count: candidates.len(),
                    result_count: items.len(),
                    error_code: None,
                },
            );
            return LlmEnhancementResult::ok(items);
        }
    }

    let started = Instant::now();
    let first_attempt = provider
        .chat_json(&config, &api_key, messages.clone(), true)
        .await;
    let content = match first_attempt {
        Ok(content) => content,
        Err(_) => match provider.chat_json(&config, &api_key, messages, false).await {
            Ok(content) => content,
            Err(e) => {
                let guard = conn.lock();
                log_llm_call(
                    &guard,
                    LlmCallLog {
                        request_id,
                        model: &config.model,
                        status: "request_failed",
                        latency_ms: Some(started.elapsed().as_millis() as i64),
                        candidate_count: candidates.len(),
                        result_count: 0,
                        error_code: Some(&e),
                    },
                );
                return LlmEnhancementResult::failed(local_items, e);
            }
        },
    };

    let latency_ms = started.elapsed().as_millis() as i64;
    match apply_llm_response(&content, local_items.clone(), max_results, request_id) {
        Some(items) => {
            let guard = conn.lock();
            let _ = save_cache(&guard, &cache_key, &config, &content);
            log_llm_call(
                &guard,
                LlmCallLog {
                    request_id,
                    model: &config.model,
                    status: "ok",
                    latency_ms: Some(latency_ms),
                    candidate_count: candidates.len(),
                    result_count: items.len(),
                    error_code: None,
                },
            );
            LlmEnhancementResult::ok(items)
        }
        None => {
            let guard = conn.lock();
            log_llm_call(
                &guard,
                LlmCallLog {
                    request_id,
                    model: &config.model,
                    status: "invalid_json",
                    latency_ms: Some(latency_ms),
                    candidate_count: candidates.len(),
                    result_count: 0,
                    error_code: None,
                },
            );
            LlmEnhancementResult::failed(local_items, "模型响应 JSON 不符合推荐格式".to_string())
        }
    }
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

fn can_call_llm(config: &LlmConfig) -> bool {
    config.enabled && !config.base_url.trim().is_empty() && !config.model.trim().is_empty()
}

fn cache_key(config: &LlmConfig, messages: &[serde_json::Value], limit: usize) -> String {
    let payload = serde_json::json!({
        "prompt_schema_version": prompt::PROMPT_SCHEMA_VERSION,
        "base_url": normalize_base_url(&config.base_url),
        "model": config.model.trim(),
        "limit": limit,
        "messages": messages,
    });
    format!("{:x}", md5::compute(payload.to_string()))
}

fn normalize_base_url(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    reqwest::Url::parse(trimmed)
        .map(|mut url| {
            url.set_fragment(None);
            url.to_string().trim_end_matches('/').to_string()
        })
        .unwrap_or_else(|_| trimmed.to_string())
}

fn load_cache(conn: &Connection, cache_key: &str) -> rusqlite::Result<Option<String>> {
    let now = catalog::now_ms();
    conn.query_row(
        "SELECT response_json FROM llm_recommendation_cache WHERE cache_key = ?1 AND expires_at > ?2",
        params![cache_key, now],
        |row| row.get(0),
    )
    .optional()
}

fn save_cache(
    conn: &Connection,
    cache_key: &str,
    config: &LlmConfig,
    content: &str,
) -> rusqlite::Result<()> {
    let now = catalog::now_ms();
    let payload_hash = format!("{:x}", md5::compute(content));
    conn.execute(
        r#"
        INSERT INTO llm_recommendation_cache (cache_key, model, payload_hash, response_json, created_at, expires_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(cache_key) DO UPDATE SET
          model = excluded.model,
          payload_hash = excluded.payload_hash,
          response_json = excluded.response_json,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
        "#,
        params![
            cache_key,
            config.model,
            payload_hash,
            content,
            now,
            now + config.cache_ttl_seconds * 1000,
        ],
    )?;
    Ok(())
}

fn apply_llm_response(
    content: &str,
    local_items: Vec<RecommendationItem>,
    limit: usize,
    request_id: &str,
) -> Option<Vec<RecommendationItem>> {
    let parsed: LlmResponse = serde_json::from_str(content.trim()).ok()?;
    if parsed.items.is_empty() {
        return None;
    }

    let mut by_key: HashMap<String, RecommendationItem> = local_items
        .iter()
        .cloned()
        .map(|item| (catalog::track_key(&item.song), item))
        .collect();
    let valid_keys: HashSet<_> = by_key.keys().cloned().collect();
    let unknown_count = parsed
        .items
        .iter()
        .filter(|item| !valid_keys.contains(&item.track_key))
        .count();
    if unknown_count > 0 && (unknown_count as f64 / parsed.items.len() as f64) > 0.2 {
        return None;
    }

    let mut ordered = Vec::new();
    let total = parsed.items.len().max(1) as f64;
    for (index, llm_item) in parsed.items.into_iter().enumerate() {
        let Some(mut item) = by_key.remove(&llm_item.track_key) else {
            continue;
        };
        let rank_score = llm_item
            .score
            .unwrap_or_else(|| {
                llm_item
                    .rank
                    .map(|rank| 1.0 - ((rank.saturating_sub(1) as f64) / total))
                    .unwrap_or_else(|| 1.0 - (index as f64 / total))
            })
            .clamp(0.0, 1.0);
        let explanation_confidence = if llm_item
            .reason
            .as_deref()
            .map(|reason| !reason.trim().is_empty())
            .unwrap_or(false)
        {
            1.0
        } else {
            0.0
        };
        item.score =
            (0.65 * item.score + 0.25 * rank_score + 0.10 * explanation_confidence).clamp(0.0, 1.0);
        item.recommendation_source = "hybrid".to_string();
        item.request_id = request_id.to_string();
        if let Some(reason) = prompt::item_reason(llm_item.reason.as_deref()) {
            item.reasons.insert(0, reason);
            item.reasons.truncate(3);
        }
        ordered.push(item);
    }

    let mut rest: Vec<_> = by_key.into_values().collect();
    rest.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    ordered.extend(rest);

    let mut candidates: Vec<_> = ordered
        .into_iter()
        .map(|item| super::model::Candidate {
            track_key: catalog::track_key(&item.song),
            song: item.song,
            local_score: item.score,
            itemcf_score: 0.0,
            profile_score: 0.0,
            artist_match: 0.0,
            source_preference: 0.0,
            recent_penalty: 0.0,
            dismiss_penalty: 0.0,
            quality_bonus: 0.0,
            freshness_bonus: 0.0,
            diversity_seed_score: 0.0,
            reasons: item.reasons,
            last_seen_at: 0,
        })
        .collect();
    candidates.sort_by(|a, b| {
        b.local_score
            .partial_cmp(&a.local_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Some(rerank::to_items(
        rerank::mmr(candidates, limit),
        request_id,
        "hybrid",
    ))
}

struct LlmCallLog<'a> {
    request_id: &'a str,
    model: &'a str,
    status: &'a str,
    latency_ms: Option<i64>,
    candidate_count: usize,
    result_count: usize,
    error_code: Option<&'a str>,
}

fn log_llm_call(conn: &Connection, call: LlmCallLog<'_>) {
    let _ = conn.execute(
        r#"
        INSERT INTO llm_calls (
          request_id, model, status, latency_ms, candidate_count, result_count, error_code, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            call.request_id,
            call.model,
            call.status,
            call.latency_ms,
            call.candidate_count as i64,
            call.result_count as i64,
            call.error_code.map(privacy::short_reason),
            catalog::now_ms(),
        ],
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(base_url: &str, model: &str) -> LlmConfig {
        LlmConfig {
            enabled: true,
            base_url: base_url.to_string(),
            model: model.to_string(),
            timeout_ms: 8_000,
            max_candidates: 80,
            max_results: 30,
            cache_ttl_seconds: 3_600,
            upload_recent_events: false,
        }
    }

    #[test]
    fn cache_key_uses_normalized_provider_final_messages_and_limit() {
        let messages = vec![serde_json::json!({"role": "user", "content": "a"})];
        let changed_messages = vec![serde_json::json!({"role": "user", "content": "b"})];
        let first = cache_key(
            &config(" HTTPS://Example.com/v1/ ", " model "),
            &messages,
            10,
        );
        let normalized = cache_key(&config("https://example.com/v1", "model"), &messages, 10);

        assert_eq!(first, normalized);
        assert_ne!(
            first,
            cache_key(&config("https://example.com/v2", "model"), &messages, 10)
        );
        assert_ne!(
            first,
            cache_key(&config("https://example.com/v1", "other"), &messages, 10)
        );
        assert_ne!(
            first,
            cache_key(
                &config("https://example.com/v1", "model"),
                &changed_messages,
                10
            )
        );
        assert_ne!(
            first,
            cache_key(&config("https://example.com/v1", "model"), &messages, 20)
        );
    }
}
