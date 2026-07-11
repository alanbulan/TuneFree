use super::*;

#[test]
fn maintenance_enforces_time_boundaries_and_snapshot_cap() {
    let mut conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    let now = 2_000_000_000_000_i64;
    let track = song("netease", "1", "保留歌曲", "保留歌手");
    let track_key = catalog::upsert_track(&conn, &track).unwrap();
    for created_at in [
        now - PLAY_EVENT_RETENTION_MS - 1,
        now - PLAY_EVENT_RETENTION_MS,
    ] {
        conn.execute(
                "INSERT INTO play_events (event_type, track_key, session_id, weight, created_at) VALUES ('play_complete', ?1, 'playback:test', 4.0, ?2)",
                params![track_key, created_at],
            )
            .unwrap();
    }
    for created_at in [now - FEEDBACK_RETENTION_MS - 1, now - FEEDBACK_RETENTION_MS] {
        conn.execute(
                "INSERT INTO recommendation_feedback (request_id, track_key, action, recommendation_source, created_at) VALUES ('r', ?1, 'play', 'local', ?2)",
                params![track_key, created_at],
            )
            .unwrap();
    }
    for index in 0..25 {
        conn.execute(
                "INSERT INTO recommendation_result_snapshots (context, result_source, job_id, detail, items_json, created_at) VALUES ('home', 'cloud', ?1, '', '[]', ?2)",
                params![format!("recent-{index}"), now - index],
            )
            .unwrap();
    }
    conn.execute(
            "INSERT INTO recommendation_result_snapshots (context, result_source, job_id, detail, items_json, created_at) VALUES ('boundary', 'cloud', 'boundary', '', '[]', ?1)",
            [now - RESULT_SNAPSHOT_RETENTION_MS],
        )
        .unwrap();
    conn.execute(
            "INSERT INTO recommendation_result_snapshots (context, result_source, job_id, detail, items_json, created_at) VALUES ('other', 'cloud', 'expired', '', '[]', ?1)",
            [now - RESULT_SNAPSHOT_RETENTION_MS - 1],
        )
        .unwrap();

    assert!(run_recommendation_maintenance_at(&mut conn, now).unwrap());
    let event_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM play_events", [], |row| row.get(0))
        .unwrap();
    let feedback_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM recommendation_feedback", [], |row| {
            row.get(0)
        })
        .unwrap();
    let home_snapshot_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM recommendation_result_snapshots WHERE context = 'home'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let expired_snapshot_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM recommendation_result_snapshots WHERE job_id = 'expired'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let boundary_snapshot_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM recommendation_result_snapshots WHERE job_id = 'boundary'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(event_count, 1);
    assert_eq!(feedback_count, 1);
    assert_eq!(home_snapshot_count, RESULT_SNAPSHOT_LIMIT);
    assert_eq!(expired_snapshot_count, 0);
    assert_eq!(boundary_snapshot_count, 1);
    assert!(!run_recommendation_maintenance_at(&mut conn, now).unwrap());
}

#[test]
fn session_cooccurrence_ignores_legacy_sessions_and_uses_bounded_window() {
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    let songs: Vec<_> = (0..7)
        .map(|index| song("netease", &index.to_string(), &format!("歌{index}"), "歌手"))
        .collect();

    let legacy = RecommendationEvent {
        event_type: "play_start".to_string(),
        song: Some(songs[0].clone()),
        session_id: None,
        position_seconds: Some(0.0),
        duration_seconds: None,
        quality: None,
        context: Some("playback".to_string()),
    };
    events::insert_event(&conn, &legacy).unwrap();

    for item in &songs {
        let event = RecommendationEvent {
            event_type: "play_start".to_string(),
            song: Some(item.clone()),
            session_id: Some("playback:a".to_string()),
            position_seconds: Some(0.0),
            duration_seconds: None,
            quality: None,
            context: Some("playback".to_string()),
        };
        events::insert_event(&conn, &event).unwrap();
    }
    let other_session_song = song("qq", "other", "其它会话", "其它歌手");
    let other_session = RecommendationEvent {
        event_type: "play_start".to_string(),
        song: Some(other_session_song.clone()),
        session_id: Some("playback:b".to_string()),
        position_seconds: Some(0.0),
        duration_seconds: None,
        quality: None,
        context: Some("playback".to_string()),
    };
    events::insert_event(&conn, &other_session).unwrap();

    rebuild_cooccurrence_index(&conn).unwrap();
    let first_key = catalog::track_key(&songs[0]);
    let second_key = catalog::track_key(&songs[1]);
    let seventh_key = catalog::track_key(&songs[6]);
    let other_key = catalog::track_key(&other_session_song);
    let pair_count = |related: &str| -> i64 {
        conn.query_row(
                "SELECT COUNT(*) FROM item_cooccurrence WHERE track_key = ?1 AND related_track_key = ?2",
                params![first_key, related],
                |row| row.get(0),
            )
            .unwrap()
    };

    assert_eq!(pair_count(&second_key), 1);
    assert_eq!(pair_count(&seventh_key), 0);
    assert_eq!(pair_count(&other_key), 0);
}

#[test]
fn clear_recommendation_storage_removes_cloud_snapshots() {
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    let items = vec![recommendation_item("netease", "1", "云端歌")];

    save_cloud_recommendation_result(&conn, "home", "job-1", "done", &items).unwrap();
    conn.execute(
            "INSERT INTO library_membership (container_type, container_id, track_key, updated_at) VALUES ('favorite', 'favorites', 'netease:1', 1)",
            [],
        )
        .unwrap();
    assert!(load_latest_cloud_recommendation_job(&conn, "home")
        .unwrap()
        .is_some());

    clear_recommendation_storage(&conn).unwrap();
    assert!(load_latest_cloud_recommendation_job(&conn, "home")
        .unwrap()
        .is_none());
    let membership_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM library_membership", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(membership_count, 0);
}
