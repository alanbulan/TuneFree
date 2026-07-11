use rusqlite::{params, Connection, OptionalExtension};

use crate::recommendation::{catalog, model::LlmConfig, prompt};

pub(super) fn cache_key(
    config: &LlmConfig,
    messages: &[serde_json::Value],
    limit: usize,
) -> String {
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
}
