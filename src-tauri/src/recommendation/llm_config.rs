use rusqlite::{params, Connection};

use super::{
    catalog,
    credential_store::{self, CredentialStoreError},
    model::{LlmConfig, LlmConfigInput, LlmConfigView},
};
use crate::app::error::{CommandError, ErrorCode};

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

pub fn config_from_input(input: &LlmConfigInput) -> LlmConfig {
    LlmConfig {
        enabled: input.enabled,
        base_url: input.base_url.trim().to_string(),
        model: input.model.trim().to_string(),
        timeout_ms: input.timeout_ms.unwrap_or(8000).clamp(1000, 60000),
        max_candidates: input.max_candidates.unwrap_or(80).clamp(1, 120),
        max_results: input.max_results.unwrap_or(30).clamp(1, 50),
        cache_ttl_seconds: input
            .cache_ttl_seconds
            .unwrap_or(86400)
            .clamp(60, 7 * 24 * 60 * 60),
        upload_recent_events: input.upload_recent_events.unwrap_or(false),
    }
}

fn validate_config(config: &mut LlmConfig) -> Result<(), String> {
    if !config.base_url.is_empty() {
        config.base_url = super::privacy::validate_base_url(&config.base_url)?;
    }
    Ok(())
}

pub fn view_config(
    conn: &Connection,
    database_size_bytes: u64,
    last_error: Option<String>,
) -> Result<LlmConfigView, String> {
    let config = load_config(conn).map_err(|e| format!("读取模型配置失败: {}", e))?;
    let local_recommendation_enabled =
        load_recommendation_enabled(conn).map_err(|e| format!("读取推荐开关失败: {}", e))?;
    // 取密钥失败只降级为"未配置"，不能让整个设置视图打不开。
    let has_api_key = credential_store::get_api_key(conn)
        .map(|key| !key.trim().is_empty())
        .unwrap_or_else(|error| {
            log::warn!("读取 API Key 状态失败，按未配置处理: {}", error);
            false
        });
    let llm_cache_entries = conn
        .query_row("SELECT COUNT(*) FROM llm_recommendation_cache", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap_or(0)
        .max(0) as usize;
    Ok(LlmConfigView {
        local_recommendation_enabled,
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

fn credential_error(error: CredentialStoreError) -> CommandError {
    match error {
        CredentialStoreError::Unavailable(message) => {
            CommandError::new(ErrorCode::CredentialUnavailable, message)
        }
        CredentialStoreError::Failure(message) => CommandError::internal(message),
    }
}

pub fn save_config(conn: &Connection, input: LlmConfigInput) -> Result<(), CommandError> {
    let mut config = config_from_input(&input);
    validate_config(&mut config)
        .map_err(|message| CommandError::new(ErrorCode::LlmConfigInvalid, message))?;
    let local_recommendation_enabled = input.local_recommendation_enabled;

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
            if config.enabled { 1 } else { 0 },
            config.base_url,
            config.model,
            config.timeout_ms as i64,
            config.max_candidates as i64,
            config.max_results as i64,
            config.cache_ttl_seconds,
            if config.upload_recent_events { 1 } else { 0 },
            catalog::now_ms(),
        ],
    )
    .map_err(|e| CommandError::database(format!("保存模型配置失败: {}", e)))?;

    if let Some(enabled) = local_recommendation_enabled {
        save_recommendation_enabled(conn, enabled).map_err(CommandError::database)?;
    }

    if input.clear_api_key.unwrap_or(false) {
        credential_store::delete_api_key(conn).map_err(credential_error)?;
    } else if let Some(api_key) = input.api_key {
        let api_key = api_key.trim();
        if !api_key.is_empty() {
            credential_store::save_api_key(conn, api_key).map_err(credential_error)?;
            let saved_api_key =
                credential_store::get_api_key(conn).map_err(CommandError::internal)?;
            if saved_api_key.trim() != api_key {
                return Err(CommandError::internal(
                    "API Key 已提交保存，但本地配置校验失败",
                ));
            }
        }
    }

    Ok(())
}

pub fn load_recommendation_enabled(conn: &Connection) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT enabled FROM recommendation_settings WHERE id = 1",
        [],
        |row| Ok(row.get::<_, i64>(0)? != 0),
    )
}

fn save_recommendation_enabled(conn: &Connection, enabled: bool) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO recommendation_settings (id, enabled, updated_at)
        VALUES (1, ?1, ?2)
        ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
        "#,
        params![if enabled { 1 } else { 0 }, catalog::now_ms()],
    )
    .map(|_| ())
    .map_err(|e| format!("保存推荐开关失败: {}", e))
}

pub fn get_api_key(conn: &Connection) -> Result<String, String> {
    credential_store::get_api_key(conn)
}

#[cfg(all(test, windows))]
#[path = "__tests__/llm_config.rs"]
mod tests;
