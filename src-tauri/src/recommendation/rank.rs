use std::collections::HashSet;

use rusqlite::Connection;

use super::{catalog, model::{Candidate, RecSong}, profile, recall};

pub fn rank_candidates(
    conn: &Connection,
    mut candidates: Vec<Candidate>,
    seed: Option<&RecSong>,
) -> rusqlite::Result<Vec<Candidate>> {
    let profile_tokens = profile::top_profile_tokens(conn, 30)?;
    let dismissed = recall::dismissed_track_keys(conn)?;
    let recent_complete = recall::recent_complete_track_keys(conn)?;
    let max_itemcf = candidates
        .iter()
        .map(|candidate| candidate.itemcf_score)
        .fold(0.0_f64, f64::max)
        .max(1.0);

    let seed_artist = seed.map(|song| catalog::normalize_text(&song.artist));
    let seed_source = seed.map(|song| catalog::normalize_text(&song.source));
    let now = catalog::now_ms();

    for candidate in &mut candidates {
        candidate.profile_score = profile::profile_score(&profile_tokens, &candidate.song);
        candidate.itemcf_score = (candidate.itemcf_score / max_itemcf).clamp(0.0, 1.0);
        candidate.quality_bonus = catalog::quality_bonus(&candidate.song);
        candidate.dismiss_penalty = if dismissed.contains(&candidate.track_key) { 1.0 } else { 0.0 };
        candidate.recent_penalty = if recent_complete.contains(&candidate.track_key) { 1.0 } else { 0.0 };
        candidate.freshness_bonus = if now - candidate.last_seen_at < 7 * 24 * 60 * 60 * 1000 {
            0.3
        } else {
            0.0
        };
        if let Some(seed_artist) = &seed_artist {
            if catalog::normalize_text(&candidate.song.artist) == *seed_artist && !seed_artist.is_empty() {
                candidate.artist_match = 1.0;
                push_reason(candidate, format!("因为你常听 {}", candidate.song.artist));
            }
        }
        if let Some(seed_source) = &seed_source {
            if catalog::normalize_text(&candidate.song.source) == *seed_source {
                candidate.source_preference = 1.0;
            }
        }
        if let Some(seed_song) = seed {
            candidate.diversity_seed_score = catalog::content_similarity(seed_song, &candidate.song);
        }
        if candidate.profile_score > 0.2 {
            push_reason(candidate, "来自你的本地画像偏好".to_string());
        }
        if candidate.quality_bonus > 0.0 {
            push_reason(candidate, "高音质候选".to_string());
        }

        candidate.local_score =
            1.20 * candidate.profile_score +
            1.00 * candidate.itemcf_score +
            0.70 * candidate.artist_match +
            0.35 * candidate.source_preference +
            0.20 * candidate.quality_bonus +
            0.15 * candidate.freshness_bonus +
            0.25 * candidate.diversity_seed_score -
            1.50 * candidate.recent_penalty -
            3.00 * candidate.dismiss_penalty;
    }

    let mut seen_song_identity = HashSet::new();
    candidates.retain(|candidate| {
        if candidate.dismiss_penalty >= 1.0 || candidate.recent_penalty >= 1.0 {
            return false;
        }
        let identity = format!(
            "{}:{}",
            catalog::normalize_text(&candidate.song.name),
            catalog::normalize_text(&candidate.song.artist)
        );
        seen_song_identity.insert(identity)
    });

    candidates.sort_by(|a, b| {
        b.local_score
            .partial_cmp(&a.local_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(candidates)
}

fn push_reason(candidate: &mut Candidate, reason: String) {
    if candidate.reasons.len() >= 3 {
        return;
    }
    if !candidate.reasons.iter().any(|item| item == &reason) {
        candidate.reasons.push(reason);
    }
}
