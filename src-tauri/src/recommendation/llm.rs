use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Instant,
};

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use super::{
    catalog,
    llm_config,
    model::{LlmConfig, ProfileToken, RecommendationItem, RecommendationQuery},
    privacy, prompt, rerank,
    provider::OpenAiCompatibleProvider,
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

pub async fn enhance_recommendations(
    conn: Arc<Mutex<Connection>>,
    provider: &OpenAiCompatibleProvider,
    query: &RecommendationQuery,
    local_items: Vec<RecommendationItem>,
    request_id: &str,
) -> Vec<RecommendationItem> {
    let (config, api_key, profile_tokens, cache_key, cached_content) = {
        let guard = conn.lock();
        let config = match llm_config::load_config(&guard) {
            Ok(config) => config,
            Err(e) => {
                log_llm_call(&guard, request_id, "", "config_error", None, local_items.len(), 0, Some(&e.to_string()));
                return local_items;
            }
        };

        if !can_call_llm(&config) {
            return local_items;
        }

        let api_key = match llm_config::get_api_key(&guard) {
            Ok(key) if !key.trim().is_empty() => key,
            Ok(_) => return local_items,
            Err(e) => {
                log_llm_call(&guard, request_id, &config.model, "key_error", None, local_items.len(), 0, Some(&e));
                return local_items;
            }
        };

        let max_candidates = config.max_candidates.min(local_items.len()).max(1);
        let candidates: Vec<_> = local_items.iter().take(max_candidates).cloned().collect();
        let profile_tokens = super::profile::top_profile_tokens(&guard, 30).unwrap_or_default();
        let cache_key = cache_key(&config, query, &profile_tokens, &candidates);
        let cached_content = load_cache(&guard, &cache_key).ok().flatten();
        (config, api_key, profile_tokens, cache_key, cached_content)
    };

    let max_candidates = config.max_candidates.min(local_items.len()).max(1);
    let max_results = config
        .max_results
        .min(query.limit.unwrap_or(30))
        .min(local_items.len())
        .max(1);
    let candidates: Vec<_> = local_items.iter().take(max_candidates).cloned().collect();

    if let Some(content) = cached_content {
        if let Some(items) = apply_llm_response(&content, local_items.clone(), max_results, request_id) {
            let guard = conn.lock();
            log_llm_call(&guard, request_id, &config.model, "cache_hit", Some(0), candidates.len(), items.len(), None);
            return items;
        }
    }

    let messages = prompt::build_messages(query, &profile_tokens, &candidates, max_results);
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
                request_id,
                &config.model,
                "request_failed",
                Some(started.elapsed().as_millis() as i64),
                candidates.len(),
                0,
                Some(&e),
                );
                return local_items;
            }
        },
    };

    let latency_ms = started.elapsed().as_millis() as i64;
    match apply_llm_response(&content, local_items.clone(), max_results, request_id) {
        Some(items) => {
            let guard = conn.lock();
            let _ = save_cache(&guard, &cache_key, &config, &content);
            log_llm_call(&guard, request_id, &config.model, "ok", Some(latency_ms), candidates.len(), items.len(), None);
            items
        }
        None => {
            let guard = conn.lock();
            log_llm_call(&guard, request_id, &config.model, "invalid_json", Some(latency_ms), candidates.len(), 0, None);
            local_items
        }
    }
}

fn can_call_llm(config: &LlmConfig) -> bool {
    config.enabled && !config.base_url.trim().is_empty() && !config.model.trim().is_empty()
}

fn cache_key(
    config: &LlmConfig,
    query: &RecommendationQuery,
    profile_tokens: &[ProfileToken],
    candidates: &[RecommendationItem],
) -> String {
    let payload = serde_json::json!({
        "model": config.model,
        "context": query.context,
        "seed": query.seed.as_ref().map(catalog::track_key),
        "profile": profile_tokens,
        "candidates": candidates.iter().map(|item| catalog::track_key(&item.song)).collect::<Vec<_>>(),
    });
    format!("{:x}", md5::compute(payload.to_string()))
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

fn save_cache(conn: &Connection, cache_key: &str, config: &LlmConfig, content: &str) -> rusqlite::Result<()> {
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
        let explanation_confidence = if llm_item.reason.as_deref().map(|reason| !reason.trim().is_empty()).unwrap_or(false) {
            1.0
        } else {
            0.0
        };
        item.score = (0.65 * item.score + 0.25 * rank_score + 0.10 * explanation_confidence).clamp(0.0, 1.0);
        item.recommendation_source = "hybrid".to_string();
        item.request_id = request_id.to_string();
        if let Some(reason) = prompt::item_reason(llm_item.reason.as_deref()) {
            item.reasons.insert(0, reason);
            item.reasons.truncate(3);
        }
        ordered.push(item);
    }

    let mut rest: Vec<_> = by_key.into_values().collect();
    rest.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
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
    candidates.sort_by(|a, b| b.local_score.partial_cmp(&a.local_score).unwrap_or(std::cmp::Ordering::Equal));
    Some(rerank::to_items(rerank::mmr(candidates, limit), request_id, "hybrid"))
}

fn log_llm_call(
    conn: &Connection,
    request_id: &str,
    model: &str,
    status: &str,
    latency_ms: Option<i64>,
    candidate_count: usize,
    result_count: usize,
    error_code: Option<&str>,
) {
    let _ = conn.execute(
        r#"
        INSERT INTO llm_calls (
          request_id, model, status, latency_ms, candidate_count, result_count, error_code, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            request_id,
            model,
            status,
            latency_ms,
            candidate_count as i64,
            result_count as i64,
            error_code.map(|value| privacy::short_reason(value)),
            catalog::now_ms(),
        ],
    );
}
