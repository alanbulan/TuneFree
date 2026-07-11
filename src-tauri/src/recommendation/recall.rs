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
    max_candidates: usize,
) -> bool {
    let is_new = !by_key.contains_key(&key);
    if is_new && by_key.len() >= max_candidates {
        return false;
    }
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
    is_new
}

struct SourceBudget {
    added: usize,
    quota: usize,
    max_candidates: usize,
}

impl SourceBudget {
    fn new(quota: usize, max_candidates: usize) -> Self {
        Self {
            added: 0,
            quota,
            max_candidates,
        }
    }
}

fn add_from_source(
    by_key: &mut HashMap<String, Candidate>,
    key: String,
    song: RecSong,
    last_seen_at: i64,
    reason: &str,
    budget: &mut SourceBudget,
) -> bool {
    let is_new = !by_key.contains_key(&key);
    if is_new && budget.added >= budget.quota {
        return false;
    }
    let inserted = ensure_candidate(
        by_key,
        key.clone(),
        song,
        last_seen_at,
        reason,
        budget.max_candidates,
    );
    if inserted {
        budget.added += 1;
    }
    by_key.contains_key(&key)
}

fn source_quota(max_candidates: usize, percent: usize) -> usize {
    max_candidates.saturating_mul(percent).div_ceil(100)
}

pub fn collect_candidates(
    conn: &Connection,
    seed: Option<&RecSong>,
    max_candidates: usize,
) -> rusqlite::Result<Vec<Candidate>> {
    if max_candidates == 0 {
        return Ok(Vec::new());
    }

    let mut by_key: HashMap<String, Candidate> = HashMap::new();
    let profile_tokens = profile::top_profile_tokens(conn, 30)?;
    collect_recent_tracks(conn, &mut by_key, max_candidates)?;

    if let Some(seed_song) = seed {
        collect_seed_matches(conn, &mut by_key, seed_song, max_candidates)?;
        collect_item_cooccurrence(conn, &mut by_key, seed_song, max_candidates)?;
        collect_playlist_cooccurrence(conn, &mut by_key, seed_song, max_candidates)?;
    }

    collect_positive_tracks(conn, &mut by_key, max_candidates)?;
    collect_profile_tracks(conn, &mut by_key, profile_tokens, max_candidates)?;

    let mut candidates = by_key.into_values().collect::<Vec<_>>();
    candidates.sort_by(|a, b| {
        b.itemcf_score
            .total_cmp(&a.itemcf_score)
            .then_with(|| b.last_seen_at.cmp(&a.last_seen_at))
            .then_with(|| a.track_key.cmp(&b.track_key))
    });
    candidates.truncate(max_candidates);
    Ok(candidates)
}

fn collect_recent_tracks(
    conn: &Connection,
    by_key: &mut HashMap<String, Candidate>,
    max_candidates: usize,
) -> rusqlite::Result<()> {
    let quota = source_quota(max_candidates, 35);
    for (key, song, last_seen_at) in catalog::load_recent_tracks(conn, quota)? {
        ensure_candidate(
            by_key,
            key,
            song,
            last_seen_at,
            "来自你的资料库",
            max_candidates,
        );
    }
    Ok(())
}

fn collect_seed_matches(
    conn: &Connection,
    by_key: &mut HashMap<String, Candidate>,
    seed: &RecSong,
    max_candidates: usize,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tracks WHERE normalized_artist = ?1 OR source = ?2 ORDER BY last_seen_at DESC LIMIT 120",
    )?;
    let rows = stmt.query_map(
        params![
            catalog::normalize_text(&seed.artist),
            catalog::normalize_text(&seed.source)
        ],
        |row| {
            Ok((
                row.get::<_, String>("track_key")?,
                catalog::song_from_row(row)?,
                row.get::<_, i64>("last_seen_at")?,
            ))
        },
    )?;
    let mut budget = SourceBudget::new(source_quota(max_candidates, 15), max_candidates);
    for row in rows {
        let (key, song, last_seen_at) = row?;
        if key != catalog::track_key(seed) {
            add_from_source(
                by_key,
                key,
                song,
                last_seen_at,
                "和当前播放歌曲风格相近",
                &mut budget,
            );
        }
    }
    Ok(())
}

fn collect_item_cooccurrence(
    conn: &Connection,
    by_key: &mut HashMap<String, Candidate>,
    seed: &RecSong,
    max_candidates: usize,
) -> rusqlite::Result<()> {
    collect_scored_tracks(
        conn,
        by_key,
        r#"SELECT t.*, c.score AS recall_score FROM item_cooccurrence c
           JOIN tracks t ON t.track_key = c.related_track_key
           WHERE c.track_key = ?1 ORDER BY c.score DESC LIMIT 100"#,
        &catalog::track_key(seed),
        "来自你的连续播放偏好",
        source_quota(max_candidates, 15),
        max_candidates,
    )
}

fn collect_playlist_cooccurrence(
    conn: &Connection,
    by_key: &mut HashMap<String, Candidate>,
    seed: &RecSong,
    max_candidates: usize,
) -> rusqlite::Result<()> {
    collect_scored_tracks(
        conn,
        by_key,
        r#"SELECT t.*, COUNT(DISTINCT related.container_id) AS recall_score
           FROM library_membership seed_membership
           JOIN library_membership related ON related.container_type = 'playlist'
             AND related.container_id = seed_membership.container_id
             AND related.track_key != seed_membership.track_key
           JOIN tracks t ON t.track_key = related.track_key
           WHERE seed_membership.container_type = 'playlist' AND seed_membership.track_key = ?1
           GROUP BY related.track_key ORDER BY recall_score DESC, t.last_seen_at DESC LIMIT 100"#,
        &catalog::track_key(seed),
        "来自你的歌单共现",
        source_quota(max_candidates, 15),
        max_candidates,
    )
}

fn collect_scored_tracks(
    conn: &Connection,
    by_key: &mut HashMap<String, Candidate>,
    sql: &str,
    seed_key: &str,
    reason: &str,
    quota: usize,
    max_candidates: usize,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([seed_key], |row| {
        Ok((
            row.get::<_, String>("track_key")?,
            catalog::song_from_row(row)?,
            row.get::<_, i64>("last_seen_at")?,
            row.get::<_, f64>("recall_score")?,
        ))
    })?;
    let mut budget = SourceBudget::new(quota, max_candidates);
    for row in rows {
        let (key, song, last_seen_at, score) = row?;
        if add_from_source(by_key, key.clone(), song, last_seen_at, reason, &mut budget) {
            if let Some(candidate) = by_key.get_mut(&key) {
                candidate.itemcf_score = candidate.itemcf_score.max(score);
            }
        }
    }
    Ok(())
}

fn collect_positive_tracks(
    conn: &Connection,
    by_key: &mut HashMap<String, Candidate>,
    max_candidates: usize,
) -> rusqlite::Result<()> {
    let mut budget = SourceBudget::new(source_quota(max_candidates, 10), max_candidates);
    for key in recent_positive_track_keys(conn, 120)? {
        if let Some(song) = catalog::get_track(conn, &key)? {
            add_from_source(
                by_key,
                key,
                song,
                catalog::now_ms(),
                "来自你的播放和收藏偏好",
                &mut budget,
            );
        }
    }
    Ok(())
}

fn collect_profile_tracks(
    conn: &Connection,
    by_key: &mut HashMap<String, Candidate>,
    profile_tokens: Vec<super::model::ProfileToken>,
    max_candidates: usize,
) -> rusqlite::Result<()> {
    let mut budget = SourceBudget::new(source_quota(max_candidates, 20), max_candidates);
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
            add_from_source(
                by_key,
                key,
                song,
                last_seen_at,
                "因为你常听相近风格",
                &mut budget,
            );
        }
    }
    Ok(())
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
    let mut stmt =
        conn.prepare("SELECT track_key FROM dismissed_recommendations WHERE expires_at > ?1")?;
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

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::recommendation::migration;

    fn song(index: usize) -> RecSong {
        RecSong {
            id: Value::from(index),
            source: "netease".to_string(),
            name: format!("歌曲 {index}"),
            artist: "共同歌手".to_string(),
            album: "测试专辑".to_string(),
            pic: None,
            pic_id: None,
            url_id: None,
            lyric_id: None,
            types: None,
        }
    }

    #[test]
    fn candidate_limit_applies_to_all_recall_sources() {
        let conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let songs = (0..300).map(song).collect::<Vec<_>>();
        for item in &songs {
            catalog::upsert_track(&conn, item).unwrap();
        }

        let candidates = collect_candidates(&conn, Some(&songs[0]), 25).unwrap();

        assert!(candidates.len() <= 25);
        assert!(collect_candidates(&conn, Some(&songs[0]), 0)
            .unwrap()
            .is_empty());
    }
}
