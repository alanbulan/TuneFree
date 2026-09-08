use super::*;

#[test]
fn legacy_model_settings_gain_credential_columns_without_losing_saved_values() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE llm_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0,
          base_url TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          timeout_ms INTEGER NOT NULL DEFAULT 8000,
          max_candidates INTEGER NOT NULL DEFAULT 80,
          max_results INTEGER NOT NULL DEFAULT 30,
          cache_ttl_seconds INTEGER NOT NULL DEFAULT 86400,
          upload_recent_events INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO llm_config(id, base_url, model, updated_at)
        VALUES (1, 'http://127.0.0.1:1', 'legacy-model', 1);",
    )
    .unwrap();
    run_migrations(&conn).unwrap();
    run_migrations(&conn).unwrap();
    let config: (String, String, String, i64) = conn
        .query_row(
            "SELECT base_url, model, api_key, api_key_deleted FROM llm_config WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        config,
        (
            "http://127.0.0.1:1".into(),
            "legacy-model".into(),
            String::new(),
            0
        )
    );
    assert!(!column_exists(&conn, "llm_config", "not_a_column").unwrap());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM llm_config", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn rejected_defaults_do_not_mark_migrations_as_successful() {
    for table in ["llm_config", "recommendation_settings"] {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_SQL).unwrap();
        conn.execute_batch(&format!(
            "CREATE TRIGGER reject_default BEFORE INSERT ON {table}
             BEGIN SELECT RAISE(ABORT, 'settings unavailable'); END;"
        ))
        .unwrap();
        assert!(run_migrations(&conn).is_err());
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM recommendation_schema_migrations",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
}

#[test]
fn unreadable_migration_metadata_is_reported_and_never_treated_as_applied() {
    let conn = Connection::open_in_memory().unwrap();
    assert!(run_derived_data_migration_v2(&conn).is_err());
    assert!(run_event_weight_migration_v3(&conn).is_err());
    assert!(run_recommendation_click_migration_v4(&conn).is_err());
    assert!(mark_rebuild_pending(&conn, PENDING_REBUILD_PROFILE).is_err());
    assert!(run_pending_rebuilds(&conn).is_err());
}

#[test]
fn profile_and_cooccurrence_rebuilds_can_be_resumed_independently() {
    for task in [PENDING_REBUILD_PROFILE, PENDING_REBUILD_COOCCURRENCE] {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "DELETE FROM recommendation_pending_rebuilds WHERE task != ?1",
            [task],
        )
        .unwrap();
        assert!(run_pending_rebuilds(&conn).unwrap());
        assert!(!run_pending_rebuilds(&conn).unwrap());
    }
}
