use std::collections::VecDeque;

use rusqlite::{params, Connection};

use super::{
    catalog,
    model::{RecentEventSummary, RecommendationEvent},
};

const SESSION_COOCCURRENCE_WINDOW: usize = 5;
const SESSION_GAP_MS: i64 = 30 * 60 * 1000;

#[derive(Debug, Clone)]
pub struct InsertedRecommendationEvent {
    pub id: i64,
    pub track_key: Option<String>,
    pub session_id: String,
}

pub fn event_weight(event_type: &str) -> f64 {
    match event_type {
        "play_start" => 1.0,
        "play_30s" => 2.0,
        "play_complete" => 4.0,
        "skip_early" => -2.5,
        "favorite_add" => 5.0,
        "favorite_remove" => -4.0,
        "playlist_add" => 3.0,
        "download" => 4.0,
        "recommendation_click" => 2.5,
        "similar_click" => 2.5,
        "llm_recommend_click" => 3.0,
        "dismiss" => -5.0,
        "quality_change" => 0.0,
        _ => 0.0,
    }
}

pub fn insert_event(
    conn: &Connection,
    event: &RecommendationEvent,
) -> rusqlite::Result<InsertedRecommendationEvent> {
    let now = catalog::now_ms();
    let weight = event_weight(&event.event_type);
    let (track_key, source, source_id) = if let Some(song) = &event.song {
        let key = catalog::upsert_track(conn, song)?;
        (
            Some(key),
            Some(song.source.clone()),
            Some(catalog::id_to_string(&song.id)),
        )
    } else {
        (None, None, None)
    };
    let session_id = normalized_session_id(event);

    conn.execute(
        r#"
        INSERT INTO play_events (
          event_type, track_key, source, source_id, session_id, position_seconds,
          duration_seconds, quality, context, weight, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
        params![
            event.event_type,
            track_key,
            source,
            source_id,
            session_id,
            event.position_seconds,
            event.duration_seconds,
            event.quality,
            event.context,
            weight,
            now,
        ],
    )?;

    Ok(InsertedRecommendationEvent {
        id: conn.last_insert_rowid(),
        track_key,
        session_id,
    })
}

fn normalized_session_id(event: &RecommendationEvent) -> String {
    if let Some(session_id) = event
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| value.starts_with("playback:") && value.len() <= 96)
    {
        return session_id.to_string();
    }

    event
        .context
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default")
        .to_string()
}

pub fn event_count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM play_events", [], |row| row.get(0))
}

pub fn recent_event_summaries(
    conn: &Connection,
    limit: usize,
) -> rusqlite::Result<Vec<RecentEventSummary>> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    let now = catalog::now_ms();
    let mut stmt = conn.prepare(
        r#"
        SELECT e.event_type, t.name, t.artist, e.created_at
        FROM play_events e
        JOIN tracks t ON t.track_key = e.track_key
        WHERE e.track_key IS NOT NULL
          AND e.weight != 0
          AND e.event_type IN (
            'play_30s', 'play_complete', 'skip_early', 'favorite_add',
            'favorite_remove', 'playlist_add', 'download', 'recommendation_click',
            'similar_click', 'llm_recommend_click', 'dismiss'
          )
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ?1
        "#,
    )?;
    let rows = stmt.query_map([limit as i64], |row| {
        let created_at = row.get::<_, i64>(3)?;
        Ok(RecentEventSummary {
            event_type: row.get(0)?,
            song_name: row.get(1)?,
            artist: row.get(2)?,
            age_bucket: age_bucket(now.saturating_sub(created_at)).to_string(),
        })
    })?;
    rows.collect()
}

fn age_bucket(age_ms: i64) -> &'static str {
    if age_ms < 60 * 60 * 1000 {
        "within_hour"
    } else if age_ms < 24 * 60 * 60 * 1000 {
        "today"
    } else if age_ms < 7 * 24 * 60 * 60 * 1000 {
        "within_week"
    } else {
        "older"
    }
}

pub fn update_session_cooccurrence_for_event(
    conn: &Connection,
    inserted: &InsertedRecommendationEvent,
) -> rusqlite::Result<()> {
    let Some(track_key) = inserted.track_key.as_deref() else {
        return Ok(());
    };
    if !inserted.session_id.starts_with("playback:") {
        return Ok(());
    }

    let created_at = conn.query_row(
        "SELECT created_at FROM play_events WHERE id = ?1",
        [inserted.id],
        |row| row.get::<_, i64>(0),
    )?;
    let rows = {
        let mut stmt = conn.prepare(
            r#"
            SELECT track_key
            FROM play_events
            WHERE session_id = ?1
              AND event_type = 'play_start'
              AND track_key IS NOT NULL
              AND id < ?2
              AND created_at >= ?3
              AND track_key != ?4
            GROUP BY track_key
            ORDER BY MAX(created_at) DESC, MAX(id) DESC
            LIMIT 5
            "#,
        )?;
        let rows = stmt.query_map(
            params![
                &inserted.session_id,
                inserted.id,
                created_at - SESSION_GAP_MS,
                track_key,
            ],
            |row| row.get::<_, String>(0),
        )?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let now = catalog::now_ms();
    for (index, related_key) in rows.iter().enumerate() {
        let score = 1.0 / ((index + 1) as f64);
        insert_cooccurrence(conn, track_key, related_key, score, now)?;
        insert_cooccurrence(conn, related_key, track_key, score, now)?;
    }
    Ok(())
}

pub fn rebuild_session_cooccurrence(conn: &Connection) -> rusqlite::Result<()> {
    let rows = {
        let mut stmt = conn.prepare(
            r#"
            SELECT session_id, track_key, created_at
            FROM play_events
            WHERE track_key IS NOT NULL
              AND event_type = 'play_start'
              AND session_id LIKE 'playback:%'
            ORDER BY session_id, created_at, id
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let mut current_session = String::new();
    let mut recent: VecDeque<(String, i64)> = VecDeque::new();
    let now = catalog::now_ms();
    for (session_id, track_key, created_at) in rows {
        if session_id != current_session {
            current_session = session_id;
            recent.clear();
        }
        while recent
            .front()
            .map(|(_, previous_at)| created_at.saturating_sub(*previous_at) > SESSION_GAP_MS)
            .unwrap_or(false)
        {
            recent.pop_front();
        }

        let mut related_rank = 0usize;
        for (related_key, _) in recent.iter().rev() {
            if related_key == &track_key {
                continue;
            }
            related_rank += 1;
            let score = 1.0 / (related_rank as f64);
            insert_cooccurrence(conn, &track_key, related_key, score, now)?;
            insert_cooccurrence(conn, related_key, &track_key, score, now)?;
        }

        recent.retain(|(key, _)| key != &track_key);
        recent.push_back((track_key, created_at));
        while recent.len() > SESSION_COOCCURRENCE_WINDOW {
            recent.pop_front();
        }
    }
    Ok(())
}

fn insert_cooccurrence(
    conn: &Connection,
    track_key: &str,
    related_track_key: &str,
    score: f64,
    updated_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        r#"
        INSERT INTO item_cooccurrence (track_key, related_track_key, score, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(track_key, related_track_key) DO UPDATE SET
          score = item_cooccurrence.score + excluded.score,
          updated_at = excluded.updated_at
        "#,
        params![track_key, related_track_key, score, updated_at],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::Value;

    use super::*;
    use crate::recommendation::{migration, model::RecSong};

    #[test]
    fn maps_known_event_weights() {
        assert_eq!(event_weight("play_start"), 1.0);
        assert_eq!(event_weight("play_30s"), 2.0);
        assert_eq!(event_weight("play_complete"), 4.0);
        assert_eq!(event_weight("skip_early"), -2.5);
        assert_eq!(event_weight("favorite_add"), 5.0);
        assert_eq!(event_weight("recommendation_click"), 2.5);
        assert_eq!(event_weight("dismiss"), -5.0);
    }

    #[test]
    fn non_preference_events_have_zero_weight() {
        assert_eq!(event_weight("quality_change"), 0.0);
        assert_eq!(event_weight("future_unknown_event"), 0.0);
    }

    #[test]
    fn recent_event_summary_excludes_zero_weight_and_private_fields() {
        let conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
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
        for event_type in ["play_complete", "quality_change"] {
            insert_event(
                &conn,
                &RecommendationEvent {
                    event_type: event_type.to_string(),
                    song: Some(song.clone()),
                    session_id: Some("playback:private".to_string()),
                    position_seconds: Some(12.0),
                    duration_seconds: Some(120.0),
                    quality: Some("lossless".to_string()),
                    context: Some("private-context".to_string()),
                },
            )
            .unwrap();
        }

        let summaries = recent_event_summaries(&conn, 20).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].event_type, "play_complete");
        assert_eq!(summaries[0].song_name, "测试歌曲");
        assert_eq!(summaries[0].artist, "测试歌手");
        let serialized = serde_json::to_string(&summaries).unwrap();
        assert!(!serialized.contains("playback:private"));
        assert!(!serialized.contains("private-context"));
        assert!(!serialized.contains("lossless"));
    }
}
