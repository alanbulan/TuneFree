use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::recommendation::{catalog, model::LlmConfig, prompt};

/// Only the strongest profile tokens participate in the cache key; tail
/// tokens reorder too easily under time decay and would defeat the cache.
const CACHE_KEY_PROFILE_TOKEN_LIMIT: usize = 20;

pub(super) fn cache_key(config: &LlmConfig, messages: &[Value], limit: usize) -> String {
    let payload = serde_json::json!({
        "prompt_schema_version": prompt::PROMPT_SCHEMA_VERSION,
        "base_url": normalize_base_url(&config.base_url),
        "model": config.model.trim(),
        "limit": limit,
        "messages": messages_for_cache_key(messages),
    });
    format!("{:x}", md5::compute(payload.to_string()))
}

/// Cache-key view of the request messages. Profile token weights decay
/// continuously with wall-clock time, so hashing them verbatim would make
/// every call a cache miss; the key therefore buckets those floats. The
/// actual messages sent to the model are never modified.
fn messages_for_cache_key(messages: &[Value]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            let mut message = message.clone();
            let quantized = message
                .get("content")
                .and_then(Value::as_str)
                .and_then(|content| serde_json::from_str::<Value>(content).ok())
                .map(|mut payload| {
                    quantize_payload(&mut payload);
                    payload
                });
            if let Some(payload) = quantized {
                message["content"] = Value::String(payload.to_string());
            }
            message
        })
        .collect()
}

fn quantize_payload(payload: &mut Value) {
    if let Some(tokens) = payload
        .get_mut("profile_tokens")
        .and_then(Value::as_array_mut)
    {
        tokens.truncate(CACHE_KEY_PROFILE_TOKEN_LIMIT);
        for token in tokens.iter_mut() {
            if let Some(value) = token.get("value").and_then(Value::as_f64) {
                token["value"] = Value::String(format!("{:.1}", value));
            }
        }
    }
    if let Some(candidates) = payload.get_mut("candidates").and_then(Value::as_array_mut) {
        for candidate in candidates.iter_mut() {
            if let Some(score) = candidate.get("local_score").and_then(Value::as_f64) {
                candidate["local_score"] = Value::String(format!("{:.2}", score));
            }
        }
    }
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

pub(super) fn load_cache(conn: &Connection, cache_key: &str) -> rusqlite::Result<Option<String>> {
    let now = catalog::now_ms();
    conn.query_row(
        "SELECT response_json FROM llm_recommendation_cache WHERE cache_key = ?1 AND expires_at > ?2",
        params![cache_key, now],
        |row| row.get(0),
    )
    .optional()
}

pub(super) fn save_cache(
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recommendation::model::{
        ProfileToken, RecSong, RecommendationItem, RecommendationQuery,
    };

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
        let changed = vec![serde_json::json!({"role": "user", "content": "b"})];
        let first = cache_key(
            &config(" HTTPS://Example.com/v1/ ", " model "),
            &messages,
            10,
        );
        assert_eq!(
            first,
            cache_key(&config("https://example.com/v1", "model"), &messages, 10)
        );
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
            cache_key(&config("https://example.com/v1", "model"), &changed, 10)
        );
        assert_ne!(
            first,
            cache_key(&config("https://example.com/v1", "model"), &messages, 20)
        );
    }

    fn token(key: &str, value: f64) -> ProfileToken {
        ProfileToken {
            key: key.to_string(),
            value,
        }
    }

    fn item(score: f64) -> RecommendationItem {
        RecommendationItem {
            song: RecSong {
                id: serde_json::json!("1"),
                source: "netease".to_string(),
                name: "歌曲".to_string(),
                artist: "歌手".to_string(),
                album: "专辑".to_string(),
                pic: None,
                pic_id: None,
                url_id: None,
                lyric_id: None,
                types: None,
            },
            score,
            reasons: Vec::new(),
            recommendation_source: "local".to_string(),
            request_id: "request".to_string(),
        }
    }

    fn build_messages(tokens: &[ProfileToken], items: &[RecommendationItem]) -> Vec<Value> {
        let query = RecommendationQuery {
            limit: Some(10),
            seed: None,
            context: Some("home".to_string()),
        };
        prompt::build_messages(&query, tokens, items, 10, None)
    }

    #[test]
    fn cache_key_ignores_decay_jitter_in_profile_tokens_and_scores() {
        let base = config("https://example.com/v1", "model");
        let first = cache_key(
            &base,
            &build_messages(&[token("artist:a", 2.31)], &[item(0.481)]),
            10,
        );
        let jittered = cache_key(
            &base,
            &build_messages(&[token("artist:a", 2.34)], &[item(0.483)]),
            10,
        );

        assert_eq!(first, jittered);
    }

    #[test]
    fn cache_key_still_changes_on_real_profile_or_candidate_changes() {
        let base = config("https://example.com/v1", "model");
        let first = cache_key(
            &base,
            &build_messages(&[token("artist:a", 2.31)], &[item(0.48)]),
            10,
        );

        assert_ne!(
            first,
            cache_key(
                &base,
                &build_messages(&[token("artist:a", 3.9)], &[item(0.48)]),
                10,
            )
        );
        assert_ne!(
            first,
            cache_key(
                &base,
                &build_messages(&[token("artist:b", 2.31)], &[item(0.48)]),
                10,
            )
        );
        assert_ne!(
            first,
            cache_key(
                &base,
                &build_messages(&[token("artist:a", 2.31)], &[item(0.9)]),
                10,
            )
        );
    }

    #[test]
    fn cache_key_only_reads_top_profile_tokens() {
        let base = config("https://example.com/v1", "model");
        let mut tokens: Vec<_> = (0..CACHE_KEY_PROFILE_TOKEN_LIMIT)
            .map(|index| token(&format!("artist:{index}"), 5.0 - index as f64 * 0.1))
            .collect();
        tokens.push(token("artist:tail-a", 0.31));
        let first = cache_key(&base, &build_messages(&tokens, &[]), 10);
        tokens.pop();
        tokens.push(token("artist:tail-b", 0.28));

        assert_eq!(first, cache_key(&base, &build_messages(&tokens, &[]), 10));
    }
}
