use rusqlite::{params, Connection};

use super::{catalog, model::ProfileToken};

pub fn update_profile_for_song(
    conn: &Connection,
    song: &super::model::RecSong,
    event_weight: f64,
    quality: Option<&str>,
) -> rusqlite::Result<()> {
    if event_weight == 0.0 {
        return Ok(());
    }

    let now = catalog::now_ms();
    for (key, token_weight) in catalog::extract_profile_tokens(song, quality) {
        let delta = event_weight * token_weight;
        conn.execute(
            r#"
            INSERT INTO user_profile (key, value, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
              value = user_profile.value * 0.985 + excluded.value,
              updated_at = excluded.updated_at
            "#,
            params![key, delta, now],
        )?;
    }

    prune_profile(conn)
}

pub fn prune_profile(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM user_profile WHERE key NOT IN (
            SELECT key FROM user_profile WHERE ABS(value) >= 0.05 ORDER BY value DESC LIMIT 500
        )",
        [],
    )?;
    Ok(())
}

pub fn top_profile_tokens(conn: &Connection, limit: usize) -> rusqlite::Result<Vec<ProfileToken>> {
    let mut stmt = conn.prepare(
        "SELECT key, value FROM user_profile WHERE value > 0 ORDER BY value DESC LIMIT ?1",
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
