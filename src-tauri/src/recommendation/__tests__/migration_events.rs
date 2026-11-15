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
    assert_eq!(weight, 0.0);
    let pending_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM recommendation_pending_rebuilds",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(pending_count > 0);

    assert!(run_pending_rebuilds(&conn).unwrap());
    let profile_value: Option<f64> = conn
        .query_row(
            "SELECT value FROM user_profile WHERE key = 'artist:测试歌手'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert!(profile_value.is_none());
    assert!(!run_pending_rebuilds(&conn).unwrap());

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
