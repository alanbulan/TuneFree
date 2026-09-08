use super::*;
use crate::app::error::ErrorCode;
use serde_json::json;

fn event(id: &str) -> RecommendationEvent {
    serde_json::from_value(json!({
        "eventType": "play_start",
        "sessionId": "playback:transaction-test",
        "song": {"id":id, "source":"qq", "name":id, "artist":"歌手", "album":"专辑"}
    }))
    .unwrap()
}

fn counts(conn: &Connection) -> (i64, i64, i64) {
    conn.query_row(
        "SELECT (SELECT COUNT(*) FROM tracks),
                (SELECT COUNT(*) FROM play_events),
                (SELECT COUNT(*) FROM item_cooccurrence)",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .unwrap()
}

#[test]
fn rejected_profile_and_cooccurrence_writes_roll_back_the_entire_play_event() {
    let app = crate::test_support::app();
    for (table, expected) in [
        ("user_profile", "更新推荐画像失败"),
        ("item_cooccurrence", "更新播放共现失败"),
    ] {
        let service = tests::initialized_service(&app);
        service
            .last_dynamic_refresh_at
            .store(catalog::now_ms(), Ordering::SeqCst);
        let conn = service.conn_handle().unwrap();
        service.log_event(event("first")).unwrap();
        let before = counts(&conn.lock());
        conn.lock()
            .execute_batch(&format!(
                "CREATE TRIGGER reject_write BEFORE INSERT ON {table}
                 BEGIN SELECT RAISE(ABORT, 'write rejected'); END;"
            ))
            .unwrap();
        let error = service.log_event(event("second")).unwrap_err();
        assert_eq!(error.code, ErrorCode::Database);
        assert!(error.message.contains(expected), "{}", error.message);
        assert_eq!(counts(&conn.lock()), before);
        assert!(catalog::get_track(&conn.lock(), "qq:second")
            .unwrap()
            .is_none());
        assert_eq!(service.weak_signal_count.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn a_failed_commit_does_not_publish_an_event_or_refresh_signal() {
    let app = crate::test_support::app();
    let service = tests::initialized_service(&app);
    let conn = service.conn_handle().unwrap();
    conn.lock()
        .execute_batch(
            "CREATE TABLE commit_parent (id INTEGER PRIMARY KEY);
             CREATE TABLE commit_child (
               parent_id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED
             );
             CREATE TRIGGER fail_commit AFTER INSERT ON play_events
             BEGIN INSERT INTO commit_child VALUES (1); END;",
        )
        .unwrap();
    let error = service.log_event(event("uncommitted")).unwrap_err();
    assert_eq!(error.code, ErrorCode::Database);
    assert!(error.message.contains("提交推荐事件事务失败"));
    assert_eq!(counts(&conn.lock()), (0, 0, 0));
    assert_eq!(service.weak_signal_count.load(Ordering::SeqCst), 0);
    assert!(!service.dynamic_refresh_pending.load(Ordering::SeqCst));
    assert!(conn.lock().is_autocommit());
}

#[test]
fn dismiss_feedback_records_an_exclusion_and_rolls_back_when_the_exclusion_fails() {
    let app = crate::test_support::app();
    let service = tests::initialized_service(&app);
    let feedback = RecommendationFeedback {
        request_id: "dismiss-test".into(),
        song: event("dismissed").song.unwrap(),
        action: "dismiss".into(),
        recommendation_source: "local".into(),
        context: None,
    };
    service.save_feedback(feedback.clone()).unwrap();
    let conn = service.conn_handle().unwrap();
    let reason: String = conn
        .lock()
        .query_row(
            "SELECT reason FROM dismissed_recommendations WHERE track_key='qq:dismissed'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(reason, "not_interested");
    assert_eq!(counts(&conn.lock()), (1, 1, 0));
    conn.lock()
        .execute_batch(
            "CREATE TRIGGER reject_exclusion BEFORE INSERT ON dismissed_recommendations
         BEGIN SELECT RAISE(ABORT, 'write rejected'); END;",
        )
        .unwrap();
    let generation = service.recommendation_generation.load(Ordering::SeqCst);
    assert!(service
        .save_feedback(RecommendationFeedback {
            song: event("rejected").song.unwrap(),
            ..feedback
        })
        .unwrap_err()
        .message
        .contains("保存不感兴趣失败"));
    assert_eq!(counts(&conn.lock()), (1, 1, 0));
    let feedback_count: i64 = conn
        .lock()
        .query_row("SELECT COUNT(*) FROM recommendation_feedback", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(feedback_count, 1);
    assert_eq!(
        service.recommendation_generation.load(Ordering::SeqCst),
        generation
    );
}
