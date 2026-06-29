use rusqlite::{params, Connection};

use super::{
    catalog,
    model::{LlmConfig, LlmConfigInput, LlmConfigView},
};

const KEYRING_SERVICE: &str = "TuneFree";
const KEYRING_USER: &str = "openai-compatible-api-key";

pub fn load_config(conn: &Connection) -> rusqlite::Result<LlmConfig> {
    conn.query_row(
        "SELECT enabled, base_url, model, timeout_ms, max_candidates, max_results, cache_ttl_seconds, upload_recent_events FROM llm_config WHERE id = 1",
        [],
        |row| {
            Ok(LlmConfig {
                enabled: row.get::<_, i64>(0)? != 0,
                base_url: row.get(1)?,
                model: row.get(2)?,
                timeout_ms: row.get::<_, i64>(3)?.max(1000) as u64,
                max_candidates: row.get::<_, i64>(4)?.clamp(1, 120) as usize,
                max_results: row.get::<_, i64>(5)?.clamp(1, 50) as usize,
                cache_ttl_seconds: row.get::<_, i64>(6)?.max(60),
                upload_recent_events: row.get::<_, i64>(7)? != 0,
            })
        },
    )
}

pub fn view_config(
    conn: &Connection,
    database_size_bytes: u64,
    last_error: Option<String>,
) -> Result<LlmConfigView, String> {
    let config = load_config(conn).map_err(|e| format!("读取模型配置失败: {}", e))?;
    let has_api_key = get_api_key().map(|key| !key.is_empty()).unwrap_or(false);
    let llm_cache_entries = conn
        .query_row("SELECT COUNT(*) FROM llm_recommendation_cache", [], |row| row.get::<_, i64>(0))
        .unwrap_or(0)
        .max(0) as usize;
    Ok(LlmConfigView {
        enabled: config.enabled,
        base_url: config.base_url,
        model: config.model,
        timeout_ms: config.timeout_ms,
        max_candidates: config.max_candidates,
        max_results: config.max_results,
        cache_ttl_seconds: config.cache_ttl_seconds,
        upload_recent_events: config.upload_recent_events,
        has_api_key,
        database_size_bytes,
        llm_cache_entries,
        last_error,
    })
}

pub fn save_config(conn: &Connection, input: LlmConfigInput) -> Result<(), String> {
    let timeout_ms = input.timeout_ms.unwrap_or(8000).clamp(1000, 60000);
    let max_candidates = input.max_candidates.unwrap_or(80).clamp(1, 120);
    let max_results = input.max_results.unwrap_or(30).clamp(1, 50);
    let cache_ttl_seconds = input.cache_ttl_seconds.unwrap_or(86400).clamp(60, 7 * 24 * 60 * 60);
    let upload_recent_events = input.upload_recent_events.unwrap_or(false);

    conn.execute(
        r#"
        INSERT INTO llm_config (
          id, enabled, base_url, model, timeout_ms, max_candidates, max_results,
          cache_ttl_seconds, upload_recent_events, updated_at
        ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          base_url = excluded.base_url,
          model = excluded.model,
          timeout_ms = excluded.timeout_ms,
          max_candidates = excluded.max_candidates,
          max_results = excluded.max_results,
          cache_ttl_seconds = excluded.cache_ttl_seconds,
          upload_recent_events = excluded.upload_recent_events,
          updated_at = excluded.updated_at
        "#,
        params![
            if input.enabled { 1 } else { 0 },
            input.base_url.trim(),
            input.model.trim(),
            timeout_ms as i64,
            max_candidates as i64,
            max_results as i64,
            cache_ttl_seconds,
            if upload_recent_events { 1 } else { 0 },
            catalog::now_ms(),
        ],
    )
    .map_err(|e| format!("保存模型配置失败: {}", e))?;

    if input.clear_api_key.unwrap_or(false) {
        delete_api_key()?;
    } else if let Some(api_key) = input.api_key {
        if !api_key.trim().is_empty() {
            set_api_key(api_key.trim())?;
        }
    }

    Ok(())
}

pub fn get_api_key() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("打开系统凭据失败: {}", e))?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(format!("读取系统凭据失败: {}", e)),
    }
}

fn set_api_key(api_key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("打开系统凭据失败: {}", e))?;
    entry
        .set_password(api_key)
        .map_err(|e| format!("保存系统凭据失败: {}", e))
}

fn delete_api_key() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("打开系统凭据失败: {}", e))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("删除系统凭据失败: {}", e)),
    }
}
