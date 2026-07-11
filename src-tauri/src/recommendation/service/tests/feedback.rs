use super::*;

#[test]
fn recommendation_feedback_is_atomic_and_updates_algorithm_once() {
    let mut conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    let recommended_song = song("netease", "1", "推荐歌", "推荐歌手");
    let feedback = RecommendationFeedback {
        request_id: "request-1".to_string(),
        song: recommended_song.clone(),
        action: "play".to_string(),
        recommendation_source: "hybrid".to_string(),
        context: Some("home".to_string()),
    };

    record_recommendation_feedback(&mut conn, &feedback).unwrap();
    let feedback_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM recommendation_feedback", [], |row| {
            row.get(0)
        })
        .unwrap();
    let event_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM play_events WHERE event_type = 'llm_recommend_click'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let profile_value: f64 = conn
        .query_row(
            "SELECT value FROM user_profile WHERE key = 'artist:推荐歌手'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(feedback_count, 1);
    assert_eq!(event_count, 1);
    assert!(profile_value > 0.0);

    let invalid = RecommendationFeedback {
        action: "unknown".to_string(),
        ..feedback
    };
    assert!(record_recommendation_feedback(&mut conn, &invalid).is_err());
    let counts: (i64, i64) = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM recommendation_feedback), (SELECT COUNT(*) FROM play_events)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
    assert_eq!(counts, (1, 1));
}

#[test]
fn generic_and_similar_recommendation_clicks_keep_distinct_semantics() {
    let mut conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    let recommended_song = song("netease", "1", "推荐歌", "推荐歌手");
    for (context, expected_event) in [
        ("home", "recommendation_click"),
        ("similar", "similar_click"),
    ] {
        record_recommendation_feedback(
            &mut conn,
            &RecommendationFeedback {
                request_id: format!("request-{context}"),
                song: recommended_song.clone(),
                action: "play".to_string(),
                recommendation_source: "local".to_string(),
                context: Some(context.to_string()),
            },
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM play_events WHERE event_type = ?1",
                [expected_event],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
