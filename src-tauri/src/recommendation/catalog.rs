use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use super::model::RecSong;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn id_to_string(id: &Value) -> String {
    if let Some(s) = id.as_str() {
        return s.to_string();
    }
    if let Some(n) = id.as_i64() {
        return n.to_string();
    }
    if let Some(n) = id.as_u64() {
        return n.to_string();
    }
    if let Some(n) = id.as_f64() {
        return n.to_string();
    }
    id.to_string()
}

pub fn track_key(song: &RecSong) -> String {
    format!("{}:{}", song.source, id_to_string(&song.id))
}

pub fn song_identity(song: &RecSong) -> String {
    format!(
        "{}:{}",
        normalize_text(&song.name),
        normalize_text(&song.artist)
    )
}

pub fn normalize_text(input: &str) -> String {
    input
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn split_tokens(input: &str) -> Vec<String> {
    normalize_text(input)
        .split(|ch: char| {
            ch.is_whitespace()
                || matches!(
                    ch,
                    '/' | '&' | ',' | '，' | '、' | '-' | '_' | '(' | ')' | '[' | ']'
                )
        })
        .filter_map(|part| {
            let token = part.trim();
            if token.len() >= 2 {
                Some(token.to_string())
            } else {
                None
            }
        })
        .collect()
}

pub fn upsert_track(conn: &Connection, song: &RecSong) -> rusqlite::Result<String> {
    let key = track_key(song);
    let source_id = id_to_string(&song.id);
    let now = now_ms();
    let types_json = song
        .types
        .as_ref()
        .and_then(|types| serde_json::to_string(types).ok());

    conn.execute(
        r#"
        INSERT INTO tracks (
            track_key, source, source_id, name, artist, album, pic, url_id, lyric_id,
            types_json, normalized_name, normalized_artist, first_seen_at, last_seen_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
        ON CONFLICT(track_key) DO UPDATE SET
            name = excluded.name,
            artist = excluded.artist,
            album = excluded.album,
            pic = COALESCE(excluded.pic, tracks.pic),
            url_id = COALESCE(excluded.url_id, tracks.url_id),
            lyric_id = COALESCE(excluded.lyric_id, tracks.lyric_id),
            types_json = COALESCE(excluded.types_json, tracks.types_json),
            normalized_name = excluded.normalized_name,
            normalized_artist = excluded.normalized_artist,
            last_seen_at = excluded.last_seen_at
        "#,
        params![
            key,
            song.source,
            source_id,
            song.name,
            song.artist,
            song.album,
            song.pic,
            song.url_id,
            song.lyric_id,
            types_json,
            normalize_text(&song.name),
            normalize_text(&song.artist),
            now,
        ],
    )?;

    Ok(track_key(song))
}

pub fn song_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecSong> {
    let source_id: String = row.get("source_id")?;
    let types_json: Option<String> = row.get("types_json")?;
    let types = types_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok());

    Ok(RecSong {
        id: Value::String(source_id),
        source: row.get("source")?,
        name: row.get("name")?,
        artist: row.get("artist")?,
        album: row.get("album")?,
        pic: row.get("pic")?,
        pic_id: None,
        url_id: row.get("url_id")?,
        lyric_id: row.get("lyric_id")?,
        types,
    })
}

pub fn get_track(conn: &Connection, key: &str) -> rusqlite::Result<Option<RecSong>> {
    conn.query_row(
        "SELECT * FROM tracks WHERE track_key = ?1",
        [key],
        song_from_row,
    )
    .optional()
}

pub fn load_recent_tracks(
    conn: &Connection,
    limit: usize,
) -> rusqlite::Result<Vec<(String, RecSong, i64)>> {
    let mut stmt = conn.prepare("SELECT * FROM tracks ORDER BY last_seen_at DESC LIMIT ?1")?;
    let rows = stmt.query_map([limit as i64], |row| {
        let key: String = row.get("track_key")?;
        let last_seen_at: i64 = row.get("last_seen_at")?;
        Ok((key, song_from_row(row)?, last_seen_at))
    })?;

    rows.collect()
}

pub fn extract_profile_tokens(song: &RecSong, quality: Option<&str>) -> Vec<(String, f64)> {
    let mut tokens = Vec::new();
    for artist in split_tokens(&song.artist) {
        tokens.push((format!("artist:{}", artist), 1.0));
    }
    if !song.source.trim().is_empty() {
        tokens.push((format!("source:{}", normalize_text(&song.source)), 0.45));
    }
    if !song.album.trim().is_empty() {
        tokens.push((format!("album:{}", normalize_text(&song.album)), 0.35));
    }
    for token in split_tokens(&song.name).into_iter().take(6) {
        tokens.push((format!("keyword:{}", token), 0.25));
    }
    if let Some(types) = &song.types {
        for item in types.iter().take(6) {
            let value = normalize_text(item);
            if !value.is_empty() {
                tokens.push((format!("type:{}", value), 0.25));
            }
        }
    }
    if let Some(quality) = quality {
        let value = normalize_text(quality);
        if !value.is_empty() {
            tokens.push((format!("quality:{}", value), 0.15));
        }
    }

    tokens
}

pub fn content_similarity(a: &RecSong, b: &RecSong) -> f64 {
    let mut score: f64 = 0.0;
    if normalize_text(&a.artist) == normalize_text(&b.artist) && !a.artist.trim().is_empty() {
        score = score.max(0.8);
    }
    if normalize_text(&a.album) == normalize_text(&b.album) && !a.album.trim().is_empty() {
        score = score.max(0.6);
    }
    if normalize_text(&a.source) == normalize_text(&b.source) {
        score = score.max(0.15);
    }

    let a_tokens: HashSet<_> = split_tokens(&a.name).into_iter().collect();
    let b_tokens: HashSet<_> = split_tokens(&b.name).into_iter().collect();
    if !a_tokens.is_empty() && !b_tokens.is_empty() {
        let overlap = a_tokens.intersection(&b_tokens).count() as f64;
        let denom = a_tokens.union(&b_tokens).count() as f64;
        if denom > 0.0 {
            score = score.max((overlap / denom) * 0.3);
        }
    }

    score.clamp(0.0, 1.0)
}

pub fn quality_bonus(song: &RecSong) -> f64 {
    song.types
        .as_ref()
        .map(|types| {
            if types.iter().any(|t| {
                let value = t.to_lowercase();
                value.contains("flac") || value.contains("hi-res") || value.contains("24")
            }) {
                1.0
            } else {
                0.0
            }
        })
        .unwrap_or(0.0)
}
