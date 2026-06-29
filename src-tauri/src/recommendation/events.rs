use rusqlite::{params, Connection};

use super::{catalog, model::RecommendationEvent};

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
        "similar_click" => 2.5,
        "llm_recommend_click" => 3.0,
        "dismiss" => -5.0,
        _ => 0.5,
    }
}

pub fn insert_event(conn: &Connection, event: &RecommendationEvent) -> rusqlite::Result<Option<String>> {
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
    let session_id = event
        .context
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("default");

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

    Ok(track_key)
}

pub fn event_count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM play_events", [], |row| row.get(0))
}

#[cfg(test)]
mod tests {
    use super::event_weight;

    #[test]
    fn maps_known_event_weights() {
        assert_eq!(event_weight("play_start"), 1.0);
        assert_eq!(event_weight("play_30s"), 2.0);
        assert_eq!(event_weight("play_complete"), 4.0);
        assert_eq!(event_weight("skip_early"), -2.5);
        assert_eq!(event_weight("favorite_add"), 5.0);
        assert_eq!(event_weight("dismiss"), -5.0);
    }

    #[test]
    fn unknown_events_use_small_default_weight() {
        assert_eq!(event_weight("quality_change"), 0.5);
    }
}
