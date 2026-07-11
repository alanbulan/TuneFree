use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use super::{catalog, model::ProfileToken};

const PROFILE_HALF_LIFE_MS: i64 = 30 * 24 * 60 * 60 * 1000;

pub fn update_profile_for_song(
    conn: &Connection,
    song: &super::model::RecSong,
    event_weight: f64,
    quality: Option<&str>,
) -> rusqlite::Result<()> {
    apply_profile_delta_at(conn, song, event_weight, quality, catalog::now_ms())?;
    prune_profile(conn)
}

pub fn add_library_profile_for_song(
    conn: &Connection,
    song: &super::model::RecSong,
    weight: f64,
    quality: Option<&str>,
) -> rusqlite::Result<()> {
    if weight == 0.0 {
        return Ok(());
    }

    let now = catalog::now_ms();
    for (key, token_weight) in catalog::extract_profile_tokens(song, quality) {
        conn.execute(
            r#"
                INSERT INTO library_profile (key, value, updated_at)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET
                  value = library_profile.value + excluded.value,
                  updated_at = excluded.updated_at
            "#,
            params![key, weight * token_weight, now],
        )?;
    }
    Ok(())
}

pub fn clear_library_profile(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM library_profile", [])?;
    Ok(())
}

fn apply_profile_delta_at(
    conn: &Connection,
    song: &super::model::RecSong,
    event_weight: f64,
    quality: Option<&str>,
    updated_at: i64,
) -> rusqlite::Result<()> {
    if event_weight == 0.0 {
        return Ok(());
    }

    for (key, token_weight) in catalog::extract_profile_tokens(song, quality) {
        let delta = event_weight * token_weight;
        let current = conn
            .query_row(
                "SELECT value, updated_at FROM user_profile WHERE key = ?1",
                [&key],
                |row| Ok((row.get::<_, f64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let value = current
            .map(|(value, previous_at)| decayed_value(value, previous_at, updated_at))
            .unwrap_or(0.0)
            + delta;
        conn.execute(
            r#"
            INSERT INTO user_profile (key, value, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
            "#,
            params![key, value, updated_at],
        )?;
    }

    Ok(())
}

fn decayed_value(value: f64, updated_at: i64, now: i64) -> f64 {
    let elapsed = now.saturating_sub(updated_at).max(0) as f64;
    value * 0.5_f64.powf(elapsed / PROFILE_HALF_LIFE_MS as f64)
}

pub fn rebuild_profile_from_events(conn: &Connection) -> rusqlite::Result<()> {
    let events = {
        let mut stmt = conn.prepare(
            r#"
            SELECT track_key, weight, quality, created_at
            FROM play_events
            WHERE track_key IS NOT NULL
            ORDER BY created_at, id
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    conn.execute("DELETE FROM user_profile", [])?;
    for (track_key, weight, quality, created_at) in events {
        if let Some(song) = catalog::get_track(conn, &track_key)? {
            apply_profile_delta_at(conn, &song, weight, quality.as_deref(), created_at)?;
        }
    }
    prune_profile(conn)
}

pub fn prune_profile(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM user_profile WHERE key NOT IN (
            SELECT key FROM user_profile WHERE ABS(value) >= 0.05 ORDER BY ABS(value) DESC LIMIT 500
        )",
        [],
    )?;
    Ok(())
}

pub fn prune_library_profile(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM library_profile WHERE key NOT IN (
            SELECT key FROM library_profile WHERE ABS(value) >= 0.05 ORDER BY ABS(value) DESC LIMIT 500
        )",
        [],
    )?;
    Ok(())
}

pub fn top_profile_tokens(conn: &Connection, limit: usize) -> rusqlite::Result<Vec<ProfileToken>> {
    let now = catalog::now_ms();
    let user_tokens = {
        let mut stmt = conn.prepare("SELECT key, value, updated_at FROM user_profile")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let library_tokens = {
        let mut stmt = conn.prepare("SELECT key, value FROM library_profile")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let mut combined = HashMap::<String, f64>::new();
    for (key, value, updated_at) in user_tokens {
        *combined.entry(key).or_default() += decayed_value(value, updated_at, now);
    }
    for (key, value) in library_tokens {
        *combined.entry(key).or_default() += value;
    }

    let mut tokens = combined
        .into_iter()
        .filter(|(_, value)| *value > 0.0)
        .map(|(key, value)| ProfileToken { key, value })
        .collect::<Vec<_>>();
    tokens.sort_by(|a, b| b.value.total_cmp(&a.value).then_with(|| a.key.cmp(&b.key)));
    tokens.truncate(limit);
    Ok(tokens)
}

pub fn profile_score(tokens: &[ProfileToken], song: &super::model::RecSong) -> f64 {
    let song_tokens = catalog::extract_profile_tokens(song, None);
    if song_tokens.is_empty() || tokens.is_empty() {
        return 0.0;
    }

    let mut score = 0.0;
    let max_value = tokens
        .first()
        .map(|token| token.value.abs().max(1.0))
        .unwrap_or(1.0);
    for (song_key, weight) in song_tokens {
        if let Some(profile_token) = tokens.iter().find(|token| token.key == song_key) {
            score += (profile_token.value / max_value).clamp(0.0, 1.0) * weight;
        }
    }

    score.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::recommendation::model::RecSong;

    fn connection() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE user_profile (
              key TEXT PRIMARY KEY,
              value REAL NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE library_profile (
              key TEXT PRIMARY KEY,
              value REAL NOT NULL,
              updated_at INTEGER NOT NULL
            );
            "#,
        )
        .unwrap();
        conn
    }

    fn song() -> RecSong {
        RecSong {
            id: Value::from(1),
            source: "netease".to_string(),
            name: "测试歌曲".to_string(),
            artist: "测试歌手".to_string(),
            album: "测试专辑".to_string(),
            pic: None,
            pic_id: None,
            url_id: None,
            lyric_id: None,
            types: None,
        }
    }

    #[test]
    fn top_tokens_apply_time_decay_from_updated_at() {
        let conn = connection();
        let now = catalog::now_ms();
        conn.execute(
            "INSERT INTO user_profile (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params!["artist:旧偏好", 8.0, now - PROFILE_HALF_LIFE_MS * 3],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO user_profile (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params!["artist:新偏好", 2.0, now],
        )
        .unwrap();

        let tokens = top_profile_tokens(&conn, 10).unwrap();

        assert_eq!(tokens[0].key, "artist:新偏好");
        let old = tokens
            .iter()
            .find(|token| token.key == "artist:旧偏好")
            .unwrap();
        assert!((old.value - 1.0).abs() < 0.01);
    }

    #[test]
    fn profile_update_decays_stored_value_before_adding_delta() {
        let conn = connection();
        let now = catalog::now_ms();
        conn.execute(
            "INSERT INTO user_profile (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params!["artist:测试歌手", 4.0, now - PROFILE_HALF_LIFE_MS],
        )
        .unwrap();

        update_profile_for_song(&conn, &song(), 1.0, None).unwrap();
        let value: f64 = conn
            .query_row(
                "SELECT value FROM user_profile WHERE key = 'artist:测试歌手'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert!((value - 3.0).abs() < 0.01);
    }
}
