use rusqlite::{params, Connection};

use super::{catalog, model::ProfileToken};

pub fn update_profile_for_song(
    conn: &Connection,
    song: &super::model::RecSong,
    event_weight: f64,
    quality: Option<&str>,
) -> rusqlite::Result<()> {
    apply_profile_delta(conn, song, event_weight, quality, true)?;
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

fn apply_profile_delta(
    conn: &Connection,
    song: &super::model::RecSong,
    event_weight: f64,
    quality: Option<&str>,
    apply_decay: bool,
) -> rusqlite::Result<()> {
    if event_weight == 0.0 {
        return Ok(());
    }

    let now = catalog::now_ms();
    for (key, token_weight) in catalog::extract_profile_tokens(song, quality) {
        let delta = event_weight * token_weight;
        let sql = if apply_decay {
            r#"
                INSERT INTO user_profile (key, value, updated_at)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET
                  value = user_profile.value * 0.985 + excluded.value,
                  updated_at = excluded.updated_at
            "#
        } else {
            r#"
                INSERT INTO user_profile (key, value, updated_at)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET
                  value = user_profile.value + excluded.value,
                  updated_at = excluded.updated_at
            "#
        };
        conn.execute(sql, params![key, delta, now])?;
    }

    Ok(())
}

pub fn rebuild_profile_from_events(conn: &Connection) -> rusqlite::Result<()> {
    let events = {
        let mut stmt = conn.prepare(
            r#"
            SELECT track_key, weight, quality
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
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    conn.execute("DELETE FROM user_profile", [])?;
    for (track_key, weight, quality) in events {
        if let Some(song) = catalog::get_track(conn, &track_key)? {
            apply_profile_delta(conn, &song, weight, quality.as_deref(), true)?;
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
    let mut stmt = conn.prepare(
        r#"
        SELECT key, SUM(value) AS combined_value
        FROM (
          SELECT key, value FROM user_profile
          UNION ALL
          SELECT key, value FROM library_profile
        )
        GROUP BY key
        HAVING combined_value > 0
        ORDER BY combined_value DESC
        LIMIT ?1
        "#,
    )?;
    let rows = stmt.query_map([limit as i64], |row| {
        Ok(ProfileToken {
            key: row.get(0)?,
            value: row.get(1)?,
        })
    })?;
    rows.collect()
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
