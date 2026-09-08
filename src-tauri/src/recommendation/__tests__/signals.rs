use super::*;
use rusqlite::{params, Connection};
use serde_json::json;

fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    conn
}
fn song(id: usize) -> RecSong {
    serde_json::from_value(json!({"id":id,"source":"qq","name":format!("歌曲 {id}"),"artist":"共同歌手","album":"共同专辑"})).unwrap()
}
fn event(id: usize, kind: &str) -> RecommendationEvent {
    serde_json::from_value(
        json!({"eventType":kind,"song":song(id),"sessionId":"playback:local-test"}),
    )
    .unwrap()
}
fn pairs(conn: &Connection) -> Vec<(String, String, f64)> {
    conn.prepare("SELECT track_key, related_track_key, score FROM item_cooccurrence ORDER BY track_key, related_track_key").unwrap()
        .query_map([], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap()
        .collect::<rusqlite::Result<_>>().unwrap()
}

#[test]
fn incremental_session_updates_match_rebuild_for_replays_window_limits_and_session_gaps() {
    let conn = database();
    let sequence = [0, 1, 2, 3, 4, 5, 6, 6, 7, 8];
    let now = catalog::now_ms();
    for (index, id) in sequence.into_iter().enumerate() {
        let inserted = events::insert_event(&conn, &event(id, "play_start")).unwrap();
        let timestamp = if index == 9 {
            now + 60 * 60 * 1000
        } else {
            now + index as i64 * 60000
        };
        conn.execute(
            "UPDATE play_events SET created_at=?1 WHERE id=?2",
            params![timestamp, inserted.id],
        )
        .unwrap();
        events::update_session_cooccurrence_for_event(&conn, &inserted).unwrap();
    }
    let expected = pairs(&conn);
    assert!(expected.len() > 10);
    assert!(expected
        .iter()
        .all(|(a, b, _)| a != b && a != "qq:8" && b != "qq:8"));
    conn.execute("DELETE FROM item_cooccurrence", []).unwrap();
    events::rebuild_session_cooccurrence(&conn).unwrap();
    assert_eq!(pairs(&conn), expected);
    let no_song: RecommendationEvent =
        serde_json::from_value(json!({"eventType":"quality_change"})).unwrap();
    let inserted = events::insert_event(&conn, &no_song).unwrap();
    events::update_session_cooccurrence_for_event(&conn, &inserted).unwrap();
    assert_eq!(events::event_count(&conn).unwrap(), 11);
}

#[test]
fn recent_summaries_use_coarse_age_buckets_and_do_not_include_zero_weight_events() {
    let conn = database();
    let now = catalog::now_ms();
    for (id, age) in [
        0,
        2 * 60 * 60 * 1000,
        2 * 24 * 60 * 60 * 1000,
        8 * 24 * 60 * 60 * 1000,
    ]
    .into_iter()
    .enumerate()
    {
        let inserted = events::insert_event(&conn, &event(id, "favorite_add")).unwrap();
        conn.execute(
            "UPDATE play_events SET created_at=?1 WHERE id=?2",
            params![now - age, inserted.id],
        )
        .unwrap();
    }
    events::insert_event(&conn, &event(5, "quality_change")).unwrap();
    assert!(events::recent_event_summaries(&conn, 0).unwrap().is_empty());
    assert_eq!(
        events::recent_event_summaries(&conn, 10)
            .unwrap()
            .iter()
            .map(|item| item.age_bucket.as_str())
            .collect::<Vec<_>>(),
        ["within_hour", "today", "within_week", "older"]
    );
}

#[test]
fn local_ranking_respects_seed_quality_and_exclusions_with_deterministic_ties() {
    let conn = database();
    let mut seed = song(0);
    seed.types = Some(vec!["FLAC".into(), " ".into()]);
    assert_eq!(catalog::quality_bonus(&seed), 1.0);
    assert!(catalog::extract_profile_tokens(&seed, None)
        .iter()
        .any(|(token, _)| token == "type:flac"));
    for id in 0..5 {
        catalog::upsert_track(&conn, &song(id)).unwrap();
    }
    catalog::upsert_track(&conn, &seed).unwrap();
    profile::add_library_profile_for_song(&conn, &seed, 0.0, None).unwrap();
    profile::add_library_profile_for_song(&conn, &seed, 1.0, Some("flac")).unwrap();
    conn.execute(
        "UPDATE tracks SET last_seen_at=0 WHERE track_key='qq:4'",
        [],
    )
    .unwrap();
    let candidates = recall::collect_candidates(&conn, Some(&seed), 10).unwrap();
    conn.execute("INSERT INTO dismissed_recommendations(track_key,created_at,expires_at) VALUES('qq:1',0,?1)",[catalog::now_ms()+60000]).unwrap();
    events::insert_event(&conn, &event(2, "play_complete")).unwrap();
    let ranked = rank::rank_candidates(&conn, candidates, Some(&seed)).unwrap();
    assert_eq!(ranked.len(), 3);
    assert!(ranked
        .iter()
        .all(|item| item.track_key != "qq:1" && item.track_key != "qq:2"));
    assert_eq!(ranked[0].quality_bonus, 1.0);
    assert!(ranked
        .iter()
        .all(|item| item.artist_match == 1.0 && item.source_preference == 1.0));
    assert_eq!(
        ranked
            .iter()
            .find(|item| item.track_key == "qq:4")
            .unwrap()
            .freshness_bonus,
        0.0
    );
    let mut low = seed;
    low.types = Some(vec!["mp3".into()]);
    assert_eq!(catalog::quality_bonus(&low), 0.0);
    for id in [json!(u64::MAX), json!(1.5), json!(true), json!(null)] {
        assert_eq!(catalog::id_to_string(&id), id.to_string());
    }
}
