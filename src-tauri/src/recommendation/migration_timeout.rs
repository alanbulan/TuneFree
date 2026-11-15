use super::{catalog, Connection, DEFAULT_LLM_TIMEOUT_MS};

pub(super) const LLM_TIMEOUT_MIGRATION_VERSION: i64 = 5;

/// 只升级一次旧版的 8 秒默认值，保留其他超时及升级后主动保存的 8 秒设置。
pub(super) fn run_llm_timeout_migration_v5(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let already_applied: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM recommendation_schema_migrations WHERE version = ?1)",
        [LLM_TIMEOUT_MIGRATION_VERSION],
        |row| row.get(0),
    )?;
    if !already_applied {
        tx.execute(
            include_str!("migrations/2026-11-15_005_llm_timeout.sql"),
            [DEFAULT_LLM_TIMEOUT_MS as i64],
        )?;
        tx.execute(
            "INSERT INTO recommendation_schema_migrations (version, applied_at) VALUES (?1, ?2)",
            [LLM_TIMEOUT_MIGRATION_VERSION, catalog::now_ms()],
        )?;
    }
    tx.commit()
}
