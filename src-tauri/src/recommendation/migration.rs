use rusqlite::Connection;

use super::{catalog, events, profile};

const DERIVED_DATA_MIGRATION_VERSION: i64 = 2;
const EVENT_WEIGHT_MIGRATION_VERSION: i64 = 3;
const RECOMMENDATION_CLICK_MIGRATION_VERSION: i64 = 4;

const SCHEMA_SQL: &str = r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS tracks (
          track_key TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_id TEXT NOT NULL,
          name TEXT NOT NULL,
          artist TEXT NOT NULL,
          album TEXT NOT NULL DEFAULT '',
          pic TEXT,
          url_id TEXT,
          lyric_id TEXT,
          types_json TEXT,
          normalized_name TEXT NOT NULL DEFAULT '',
          normalized_artist TEXT NOT NULL DEFAULT '',
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);
        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(normalized_artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_seen ON tracks(last_seen_at);

        CREATE TABLE IF NOT EXISTS play_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          track_key TEXT,
          source TEXT,
          source_id TEXT,
          session_id TEXT NOT NULL,
          position_seconds REAL,
          duration_seconds REAL,
          quality TEXT,
          context TEXT,
          weight REAL NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_play_events_track ON play_events(track_key, created_at);
        CREATE INDEX IF NOT EXISTS idx_play_events_type ON play_events(event_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_play_events_session ON play_events(session_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_play_events_created ON play_events(created_at);

        CREATE TABLE IF NOT EXISTS user_profile (
          key TEXT PRIMARY KEY,
          value REAL NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS library_profile (
          key TEXT PRIMARY KEY,
          value REAL NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS item_cooccurrence (
          track_key TEXT NOT NULL,
          related_track_key TEXT NOT NULL,
          score REAL NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (track_key, related_track_key)
        );

        CREATE INDEX IF NOT EXISTS idx_item_co_score ON item_cooccurrence(track_key, score DESC);

        CREATE TABLE IF NOT EXISTS library_membership (
          container_type TEXT NOT NULL,
          container_id TEXT NOT NULL,
          track_key TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (container_type, container_id, track_key)
        );

        CREATE INDEX IF NOT EXISTS idx_library_membership_track
          ON library_membership(track_key);
        CREATE INDEX IF NOT EXISTS idx_library_membership_container
          ON library_membership(container_type, container_id);

        CREATE TABLE IF NOT EXISTS recommendation_schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recommendation_maintenance (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_run_at INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS recommendation_cache (
          cache_key TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          generated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recommendation_result_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          context TEXT NOT NULL,
          result_source TEXT NOT NULL,
          job_id TEXT NOT NULL,
          detail TEXT NOT NULL,
          items_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rec_result_snapshots_latest
          ON recommendation_result_snapshots(context, result_source, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_rec_result_snapshots_created
          ON recommendation_result_snapshots(created_at);

        CREATE TABLE IF NOT EXISTS recommendation_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS dismissed_recommendations (
          track_key TEXT PRIMARY KEY,
          reason TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recommendation_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT NOT NULL,
          track_key TEXT NOT NULL,
          action TEXT NOT NULL,
          recommendation_source TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rec_feedback_request ON recommendation_feedback(request_id);
        CREATE INDEX IF NOT EXISTS idx_rec_feedback_track ON recommendation_feedback(track_key, created_at);
        CREATE INDEX IF NOT EXISTS idx_rec_feedback_created ON recommendation_feedback(created_at);

        CREATE TABLE IF NOT EXISTS llm_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0,
          base_url TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          timeout_ms INTEGER NOT NULL DEFAULT 8000,
          max_candidates INTEGER NOT NULL DEFAULT 80,
          max_results INTEGER NOT NULL DEFAULT 30,
          cache_ttl_seconds INTEGER NOT NULL DEFAULT 86400,
          upload_recent_events INTEGER NOT NULL DEFAULT 0,
          api_key TEXT NOT NULL DEFAULT '',
          api_key_deleted INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS llm_recommendation_cache (
          cache_key TEXT PRIMARY KEY,
          model TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          response_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_recommendation_cache(expires_at);

        CREATE TABLE IF NOT EXISTS llm_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT NOT NULL,
          model TEXT NOT NULL,
          status TEXT NOT NULL,
          latency_ms INTEGER,
          candidate_count INTEGER NOT NULL,
          result_count INTEGER NOT NULL,
          error_code TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at);
"#;

pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;

    conn.execute(
        "INSERT OR IGNORE INTO llm_config (
            id, enabled, base_url, model, timeout_ms, max_candidates, max_results,
            cache_ttl_seconds, upload_recent_events, updated_at
         ) VALUES (1, 0, '', '', 8000, 80, 30, 86400, 0, strftime('%s','now') * 1000)",
        [],
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

    run_derived_data_migration_v2(conn)?;
    run_event_weight_migration_v3(conn)?;
    run_recommendation_click_migration_v4(conn)?;

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
    tx.execute_batch(
        r#"
        UPDATE play_events
        SET weight = CASE event_type
          WHEN 'play_start' THEN 1.0
          WHEN 'play_30s' THEN 2.0
          WHEN 'play_complete' THEN 4.0
          WHEN 'skip_early' THEN -2.5
          WHEN 'favorite_add' THEN 5.0
          WHEN 'favorite_remove' THEN -4.0
          WHEN 'playlist_add' THEN 3.0
          WHEN 'download' THEN 4.0
          WHEN 'recommendation_click' THEN 2.5
          WHEN 'similar_click' THEN 2.5
          WHEN 'llm_recommend_click' THEN 3.0
          WHEN 'dismiss' THEN -5.0
          ELSE 0.0
        END;
        DELETE FROM item_cooccurrence;
        "#,
    )?;
    profile::rebuild_profile_from_events(&tx)?;
    events::rebuild_session_cooccurrence(&tx)?;
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
        r#"
        UPDATE play_events
        SET event_type = 'recommendation_click', weight = 2.5
        WHERE event_type = 'similar_click'
          AND COALESCE(context, '') != 'similar'
        "#,
        [],
    )?;
    profile::rebuild_profile_from_events(&tx)?;
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
    profile::rebuild_profile_from_events(&tx)?;
    profile::clear_library_profile(&tx)?;
    tx.execute("DELETE FROM item_cooccurrence", [])?;
    tx.execute(
        "INSERT INTO recommendation_schema_migrations (version, applied_at) VALUES (?1, ?2)",
        [DERIVED_DATA_MIGRATION_VERSION, catalog::now_ms()],
    )?;
    tx.commit()
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

#[cfg(test)]
mod tests {
    use rusqlite::{params, Connection, OptionalExtension};
    use serde_json::Value;

    use super::*;
    use crate::recommendation::model::RecSong;

    #[test]
    fn migration_v3_removes_historical_non_preference_weight() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let song = RecSong {
            id: Value::String("1".to_string()),
            source: "netease".to_string(),
            name: "测试歌曲".to_string(),
            artist: "测试歌手".to_string(),
            album: "测试专辑".to_string(),
            pic: None,
            pic_id: None,
            url_id: None,
            lyric_id: None,
            types: None,
        };
        let track_key = catalog::upsert_track(&conn, &song).unwrap();
        conn.execute(
            r#"
            INSERT INTO play_events
              (event_type, track_key, session_id, weight, created_at)
            VALUES ('quality_change', ?1, 'playback:test', 0.5, ?2)
            "#,
            params![track_key, catalog::now_ms()],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO user_profile (key, value, updated_at) VALUES ('artist:测试歌手', 0.5, ?1)",
            [catalog::now_ms()],
        )
        .unwrap();
        conn.execute(
            "DELETE FROM recommendation_schema_migrations WHERE version = ?1",
            [EVENT_WEIGHT_MIGRATION_VERSION],
        )
        .unwrap();

        run_migrations(&conn).unwrap();
        let weight: f64 = conn
            .query_row("SELECT weight FROM play_events", [], |row| row.get(0))
            .unwrap();
        let profile_value: Option<f64> = conn
            .query_row(
                "SELECT value FROM user_profile WHERE key = 'artist:测试歌手'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert_eq!(weight, 0.0);
        assert!(profile_value.is_none());

        run_migrations(&conn).unwrap();
        let migration_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM recommendation_schema_migrations WHERE version = ?1",
                [EVENT_WEIGHT_MIGRATION_VERSION],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migration_count, 1);
    }

    #[test]
    fn migration_v4_separates_generic_clicks_from_similar_flow() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        for context in ["home", "similar"] {
            conn.execute(
                "INSERT INTO play_events (event_type, session_id, context, weight, created_at) VALUES ('similar_click', 'default', ?1, 2.5, ?2)",
                params![context, catalog::now_ms()],
            )
            .unwrap();
        }
        conn.execute(
            "DELETE FROM recommendation_schema_migrations WHERE version = ?1",
            [RECOMMENDATION_CLICK_MIGRATION_VERSION],
        )
        .unwrap();

        run_migrations(&conn).unwrap();
        let generic_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM play_events WHERE event_type = 'recommendation_click' AND context = 'home'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let similar_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM play_events WHERE event_type = 'similar_click' AND context = 'similar'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(generic_count, 1);
        assert_eq!(similar_count, 1);
    }
}
