use super::llm_timeout::{run_llm_timeout_migration_v5, LLM_TIMEOUT_MIGRATION_VERSION};
use super::refresh_state::{run_refresh_state_migration_v6, REFRESH_STATE_MIGRATION_VERSION};
use super::*;

type Migration = (i64, fn(&Connection) -> rusqlite::Result<()>);

const MIGRATIONS: [Migration; 5] = [
    (
        DERIVED_DATA_MIGRATION_VERSION,
        run_derived_data_migration_v2,
    ),
    (
        EVENT_WEIGHT_MIGRATION_VERSION,
        run_event_weight_migration_v3,
    ),
    (
        RECOMMENDATION_CLICK_MIGRATION_VERSION,
        run_recommendation_click_migration_v4,
    ),
    (LLM_TIMEOUT_MIGRATION_VERSION, run_llm_timeout_migration_v5),
    (
        REFRESH_STATE_MIGRATION_VERSION,
        run_refresh_state_migration_v6,
    ),
];

fn seed_previous_data(conn: &Connection, version: i64) {
    run_migrations(conn).unwrap();
    conn.execute(
        "DELETE FROM recommendation_schema_migrations WHERE version = ?1",
        [version],
    )
    .unwrap();
    conn.execute_batch(
        "DELETE FROM recommendation_pending_rebuilds;
         INSERT INTO library_profile (key, value, updated_at) VALUES ('artist:test', 7, 1);
         INSERT INTO item_cooccurrence (track_key, related_track_key, score, updated_at)
           VALUES ('a', 'b', 3, 1);
         INSERT INTO play_events (event_type, session_id, context, weight, created_at)
           VALUES ('similar_click', 'test', 'home', 99, 1);
         UPDATE llm_config SET timeout_ms = 8000;",
    )
    .unwrap();
}

#[test]
fn a_rejected_migration_record_rolls_back_data_and_pending_rebuilds() {
    for (version, migrate) in MIGRATIONS {
        let conn = Connection::open_in_memory().unwrap();
        seed_previous_data(&conn, version);
        conn.execute_batch(
            "CREATE TRIGGER reject_migration BEFORE INSERT ON recommendation_schema_migrations
             BEGIN SELECT RAISE(ABORT, 'version unavailable'); END;",
        )
        .unwrap();

        assert!(migrate(&conn).is_err(), "version {version}");
        let data: (i64, i64, String, f64, i64, i64, i64) = conn
            .query_row(
                "SELECT
                 (SELECT COUNT(*) FROM library_profile),
                 (SELECT COUNT(*) FROM item_cooccurrence),
                 event_type, weight,
                 (SELECT timeout_ms FROM llm_config WHERE id = 1),
                 (SELECT COUNT(*) FROM recommendation_pending_rebuilds),
                 (SELECT COUNT(*) FROM recommendation_schema_migrations WHERE version = ?1)
                 FROM play_events",
                [version],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(data, (1, 1, "similar_click".into(), 99.0, 8000, 0, 0));

        conn.execute_batch("DROP TRIGGER reject_migration").unwrap();
        migrate(&conn).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM recommendation_schema_migrations WHERE version = ?1",
                [version],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );
    }
}

#[test]
fn already_applied_versions_leave_saved_values_and_timestamps_unchanged() {
    let conn = Connection::open_in_memory().unwrap();
    seed_previous_data(&conn, DERIVED_DATA_MIGRATION_VERSION);
    conn.execute(
        "INSERT INTO recommendation_schema_migrations (version, applied_at) VALUES (2, 123)",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE recommendation_schema_migrations SET applied_at = 123",
        [],
    )
    .unwrap();

    run_migrations(&conn).unwrap();
    run_migrations(&conn).unwrap();

    let unchanged: (i64, i64, i64, String, f64, i64, i64) = conn
        .query_row(
            "SELECT
             (SELECT COUNT(*) FROM recommendation_schema_migrations WHERE applied_at = 123),
             (SELECT COUNT(*) FROM library_profile),
             (SELECT COUNT(*) FROM item_cooccurrence), event_type, weight,
             (SELECT timeout_ms FROM llm_config WHERE id = 1),
             (SELECT COUNT(*) FROM recommendation_pending_rebuilds)
             FROM play_events",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(unchanged, (5, 1, 1, "similar_click".into(), 99.0, 8000, 0));
}
