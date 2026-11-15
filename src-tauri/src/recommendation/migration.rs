use rusqlite::Connection;

use super::{catalog, events, model::DEFAULT_LLM_TIMEOUT_MS, profile};

const DERIVED_DATA_MIGRATION_VERSION: i64 = 2;
const EVENT_WEIGHT_MIGRATION_VERSION: i64 = 3;
const RECOMMENDATION_CLICK_MIGRATION_VERSION: i64 = 4;
#[path = "migration_timeout.rs"]
mod llm_timeout;

#[cfg(test)]
#[path = "__tests__/migrations.rs"]
mod boundary_tests;

#[cfg(test)]
#[path = "__tests__/migration_events.rs"]
mod tests;

#[cfg(test)]
#[path = "__tests__/migration_transactions.rs"]
mod transaction_tests;

/// Deferred rebuild of `user_profile` from the full event history.
pub const PENDING_REBUILD_PROFILE: &str = "profile";
/// Deferred rebuild of the session co-occurrence index.
pub const PENDING_REBUILD_COOCCURRENCE: &str = "cooccurrence";

const SCHEMA_SQL: &str = include_str!("migrations/2026-11-15_001_schema.sql");

pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;

    conn.execute(
        "INSERT OR IGNORE INTO llm_config (
            id, enabled, base_url, model, timeout_ms, max_candidates, max_results,
            cache_ttl_seconds, upload_recent_events, updated_at
         ) VALUES (1, 0, '', '', ?1, 80, 30, 86400, 0, strftime('%s','now') * 1000)",
        [DEFAULT_LLM_TIMEOUT_MS as i64],
    )?;

    conn.execute(
        "INSERT OR IGNORE INTO recommendation_settings (
            id, enabled, updated_at
         ) VALUES (1, 1, strftime('%s','now') * 1000)",
        [],
    )?;

    if !column_exists(conn, "llm_config", "api_key")? {
        conn.execute(
            "ALTER TABLE llm_config ADD COLUMN api_key TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    if !column_exists(conn, "llm_config", "api_key_deleted")? {
        conn.execute(
            "ALTER TABLE llm_config ADD COLUMN api_key_deleted INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    // 顺序显式固定；文件日期表示 SQL 整理日期，历史版本号仍由数据库记录。
    run_derived_data_migration_v2(conn)?;
    run_event_weight_migration_v3(conn)?;
    run_recommendation_click_migration_v4(conn)?;
    llm_timeout::run_llm_timeout_migration_v5(conn)?;

    Ok(())
}

fn run_event_weight_migration_v3(conn: &Connection) -> rusqlite::Result<()> {
    let already_applied = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM recommendation_schema_migrations WHERE version = ?1)",
        [EVENT_WEIGHT_MIGRATION_VERSION],
        |row| row.get::<_, i64>(0),
    )? != 0;
    if already_applied {
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(include_str!("migrations/2026-11-15_003_event_weights.sql"))?;
    mark_rebuild_pending(&tx, PENDING_REBUILD_PROFILE)?;
    mark_rebuild_pending(&tx, PENDING_REBUILD_COOCCURRENCE)?;
    tx.execute(
        "INSERT INTO recommendation_schema_migrations (version, applied_at) VALUES (?1, ?2)",
        [EVENT_WEIGHT_MIGRATION_VERSION, catalog::now_ms()],
    )?;
    tx.commit()
}

fn run_recommendation_click_migration_v4(conn: &Connection) -> rusqlite::Result<()> {
    let already_applied = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM recommendation_schema_migrations WHERE version = ?1)",
        [RECOMMENDATION_CLICK_MIGRATION_VERSION],
        |row| row.get::<_, i64>(0),
    )? != 0;
    if already_applied {
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        include_str!("migrations/2026-11-15_004_recommendation_clicks.sql"),
        [],
    )?;
    mark_rebuild_pending(&tx, PENDING_REBUILD_PROFILE)?;
    tx.execute(
        "INSERT INTO recommendation_schema_migrations (version, applied_at) VALUES (?1, ?2)",
        [RECOMMENDATION_CLICK_MIGRATION_VERSION, catalog::now_ms()],
    )?;
    tx.commit()
}

fn run_derived_data_migration_v2(conn: &Connection) -> rusqlite::Result<()> {
    let already_applied = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM recommendation_schema_migrations WHERE version = ?1)",
        [DERIVED_DATA_MIGRATION_VERSION],
        |row| row.get::<_, i64>(0),
    )? != 0;
    if already_applied {
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;
    mark_rebuild_pending(&tx, PENDING_REBUILD_PROFILE)?;
    tx.execute_batch(include_str!(
        "migrations/2026-11-15_002_reset_derived_data.sql"
    ))?;
    tx.execute(
        "INSERT INTO recommendation_schema_migrations (version, applied_at) VALUES (?1, ?2)",
        [DERIVED_DATA_MIGRATION_VERSION, catalog::now_ms()],
    )?;
    tx.commit()
}

/// Records that a derived-data rebuild must run after startup. Kept in a table
/// (not memory) so a crash between migration and rebuild cannot lose the work.
/// Migrations mark instead of rebuilding inline so opening the database stays
/// fast; the service executes [`run_pending_rebuilds`] in the background.
fn mark_rebuild_pending(conn: &Connection, task: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO recommendation_pending_rebuilds (task, created_at) VALUES (?1, ?2)",
        rusqlite::params![task, catalog::now_ms()],
    )?;
    Ok(())
}

/// Executes and clears any pending derived-data rebuilds. Returns whether any
/// rebuild ran. Safe to call on every startup; a no-op costs one SELECT.
pub fn run_pending_rebuilds(conn: &Connection) -> rusqlite::Result<bool> {
    let pending = {
        let mut stmt = conn.prepare("SELECT task FROM recommendation_pending_rebuilds")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    if pending.is_empty() {
        return Ok(false);
    }

    let tx = conn.unchecked_transaction()?;
    if pending.iter().any(|task| task == PENDING_REBUILD_PROFILE) {
        profile::rebuild_profile_from_events(&tx)?;
    }
    if pending
        .iter()
        .any(|task| task == PENDING_REBUILD_COOCCURRENCE)
    {
        tx.execute("DELETE FROM item_cooccurrence", [])?;
        events::rebuild_session_cooccurrence(&tx)?;
    }
    tx.execute("DELETE FROM recommendation_pending_rebuilds", [])?;
    tx.commit()?;
    Ok(true)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for item in columns {
        if item? == column {
            return Ok(true);
        }
    }
    Ok(false)
}
