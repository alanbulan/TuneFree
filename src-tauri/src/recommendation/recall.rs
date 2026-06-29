use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};

use super::{
    catalog,
    model::{Candidate, RecSong},
    profile,
};

fn ensure_candidate(
    by_key: &mut HashMap<String, Candidate>,
    key: String,
    song: RecSong,
    last_seen_at: i64,
    reason: &str,
) {
    let candidate = by_key.entry(key.clone()).or_insert_with(|| Candidate {
        track_key: key,
        song,
        local_score: 0.0,
        itemcf_score: 0.0,
        profile_score: 0.0,
        artist_match: 0.0,
        source_preference: 0.0,
        recent_penalty: 0.0,
        dismiss_penalty: 0.0,
        quality_bonus: 0.0,
        freshness_bonus: 0.0,
        diversity_seed_score: 0.0,
        reasons: Vec::new(),
        last_seen_at,
    });
    if !candidate.reasons.iter().any(|item| item == reason) {
        candidate.reasons.push(reason.to_string());
    }
}

pub fn collect_candidates(
    conn: &Connection,
    seed: Option<&RecSong>,
    max_candidates: usize,
) -> rusqlite::Result<Vec<Candidate>> {
    let mut by_key: HashMap<String, Candidate> = HashMap::new();
    let profile_tokens = profile::top_profile_tokens(conn, 30)?;
    let recent_tracks = catalog::load_recent_tracks(conn, max_candidates.max(200))?;

    for (key, song, last_seen_at) in recent_tracks {
        ensure_candidate(&mut by_key, key, song, last_seen_at, "来自你的资料库");
        if by_key.len() >= max_candidates {
            break;
        }
    }

    if let Some(seed_song) = seed {
        let seed_artist = catalog::normalize_text(&seed_song.artist);
        let seed_source = catalog::normalize_text(&seed_song.source);
        let mut stmt = conn.prepare(
            r#"
            SELECT * FROM tracks
            WHERE normalized_artist = ?1 OR source = ?2
            ORDER BY last_seen_at DESC
            LIMIT 120
            "#,
        )?;
        let rows = stmt.query_map(params![seed_artist, seed_source], |row| {
            let key: String = row.get("track_key")?;
            let last_seen_at: i64 = row.get("last_seen_at")?;
            Ok((key, catalog::song_from_row(row)?, last_seen_at))
        })?;

        for row in rows {
            let (key, song, last_seen_at) = row?;
            if catalog::track_key(seed_song) == key {
                continue;
            }
            ensure_candidate(&mut by_key, key, song, last_seen_at, "和当前播放歌曲风格相近");
        }

        let seed_key = catalog::track_key(seed_song);
        let mut stmt = conn.prepare(
            r#"
            SELECT t.*, c.score AS itemcf_score
            FROM item_cooccurrence c
            JOIN tracks t ON t.track_key = c.related_track_key
            WHERE c.track_key = ?1
            ORDER BY c.score DESC
            LIMIT 100
            "#,
        )?;
        let rows = stmt.query_map([seed_key], |row| {
            let key: String = row.get("track_key")?;
            let last_seen_at: i64 = row.get("last_seen_at")?;
            let itemcf_score: f64 = row.get("itemcf_score")?;
            Ok((key, catalog::song_from_row(row)?, last_seen_at, itemcf_score))
        })?;
        for row in rows {
            let (key, song, last_seen_at, itemcf_score) = row?;
            ensure_candidate(&mut by_key, key.clone(), song, last_seen_at, "来自你的歌单共现");
            if let Some(candidate) = by_key.get_mut(&key) {
                candidate.itemcf_score = candidate.itemcf_score.max(itemcf_score);
            }
        }
    }

    let mut positive_tracks = recent_positive_track_keys(conn, 120)?;
    positive_tracks.truncate(120);
    for key in positive_tracks {
        if let Some(song) = catalog::get_track(conn, &key)? {
            ensure_candidate(&mut by_key, key, song, catalog::now_ms(), "来自你的播放和收藏偏好");
        }
    }

    for token in profile_tokens {
        let parts: Vec<_> = token.key.splitn(2, ':').collect();
        if parts.len() != 2 {
            continue;
        }
        let (kind, value) = (parts[0], parts[1]);
        let sql = match kind {
            "artist" => "SELECT * FROM tracks WHERE normalized_artist LIKE ?1 ORDER BY last_seen_at DESC LIMIT 80",
            "album" => "SELECT * FROM tracks WHERE album LIKE ?1 ORDER BY last_seen_at DESC LIMIT 80",
            "source" => "SELECT * FROM tracks WHERE source = ?1 ORDER BY last_seen_at DESC LIMIT 80",
            "keyword" => "SELECT * FROM tracks WHERE normalized_name LIKE ?1 ORDER BY last_seen_at DESC LIMIT 80",
            _ => continue,
        };
        let pattern = if kind == "source" {
            value.to_string()
        } else {
            format!("%{}%", value)
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([pattern], |row| {
            let key: String = row.get("track_key")?;
            let last_seen_at: i64 = row.get("last_seen_at")?;
            Ok((key, catalog::song_from_row(row)?, last_seen_at))
        })?;
        for row in rows {
            let (key, song, last_seen_at) = row?;
            ensure_candidate(&mut by_key, key, song, last_seen_at, "因为你常听相近风格");
        }
    }

    Ok(by_key.into_values().collect())
}

fn recent_positive_track_keys(conn: &Connection, limit: usize) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT track_key, SUM(weight) AS total_weight
        FROM play_events
        WHERE track_key IS NOT NULL
        GROUP BY track_key
        HAVING total_weight > 0
        ORDER BY MAX(created_at) DESC, total_weight DESC
        LIMIT ?1
        "#,
    )?;
    let rows = stmt.query_map([limit as i64], |row| row.get(0))?;
    rows.collect()
}

pub fn dismissed_track_keys(conn: &Connection) -> rusqlite::Result<HashSet<String>> {
    let now = catalog::now_ms();
    let mut stmt = conn.prepare(
        "SELECT track_key FROM dismissed_recommendations WHERE expires_at > ?1",
    )?;
    let rows = stmt.query_map([now], |row| row.get::<_, String>(0))?;
    rows.collect()
}

pub fn recent_complete_track_keys(conn: &Connection) -> rusqlite::Result<HashSet<String>> {
    let since = catalog::now_ms() - 2 * 60 * 60 * 1000;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT track_key FROM play_events WHERE track_key IS NOT NULL AND event_type = 'play_complete' AND created_at > ?1",
    )?;
    let rows = stmt.query_map([since], |row| row.get::<_, String>(0))?;
    rows.collect()
}
