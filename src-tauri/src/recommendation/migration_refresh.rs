use rusqlite::Connection;

use super::catalog;

pub(super) const REFRESH_STATE_MIGRATION_VERSION: i64 = 6;

pub(super) fn run_refresh_state_migration_v6(conn: &Connection) -> rusqlite::Result<()> {
    let applied = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM recommendation_schema_migrations WHERE version = ?1)",
        [REFRESH_STATE_MIGRATION_VERSION],
        |row| row.get::<_, bool>(0),
    )?;
    if applied {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(include_str!("migrations/2026-11-16_006_refresh_state.sql"))?;
    tx.execute(
        "INSERT INTO recommendation_schema_migrations (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![REFRESH_STATE_MIGRATION_VERSION, catalog::now_ms()],
    )?;
    tx.commit()
}
