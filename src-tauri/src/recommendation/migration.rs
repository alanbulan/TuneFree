use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
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

        CREATE TABLE IF NOT EXISTS user_profile (
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

        CREATE TABLE IF NOT EXISTS recommendation_cache (
          cache_key TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          generated_at INTEGER NOT NULL
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
        "#,
    )?;

    conn.execute(
        "INSERT OR IGNORE INTO llm_config (
            id, enabled, base_url, model, timeout_ms, max_candidates, max_results,
            cache_ttl_seconds, upload_recent_events, updated_at
         ) VALUES (1, 0, '', '', 8000, 80, 30, 86400, 0, strftime('%s','now') * 1000)",
        [],
    )?;

    if !column_exists(conn, "llm_config", "api_key")? {
        conn.execute(
            "ALTER TABLE llm_config ADD COLUMN api_key TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    Ok(())
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
