use std::collections::HashMap;

use super::{
    catalog,
    model::{Candidate, RecommendationItem},
};

pub fn mmr(mut candidates: Vec<Candidate>, limit: usize) -> Vec<Candidate> {
    let mut selected: Vec<Candidate> = Vec::new();
    let mut artist_counts: HashMap<String, usize> = HashMap::new();
    let mut source_counts: HashMap<String, usize> = HashMap::new();
    let lambda = 0.78;
    let artist_quota = quota(limit, 0.25);
    let source_quota = quota(limit, 0.70);

    while !candidates.is_empty() && selected.len() < limit {
        let has_candidate_within_quota = candidates.iter().any(|candidate| {
            is_within_quota(
                candidate,
                &artist_counts,
                &source_counts,
                artist_quota,
                source_quota,
            )
        });
        let mut best_index = 0;
        let mut best_score = f64::MIN;
        for (index, candidate) in candidates.iter().enumerate() {
            if has_candidate_within_quota
                && !is_within_quota(
                    candidate,
                    &artist_counts,
                    &source_counts,
                    artist_quota,
                    source_quota,
                )
            {
                continue;
            }
            let max_similarity = selected
                .iter()
                .map(|item| catalog::content_similarity(&item.song, &candidate.song))
                .fold(0.0_f64, f64::max);
            let score = lambda * candidate.local_score - (1.0 - lambda) * max_similarity;
            if score > best_score
                || (score == best_score && candidate.track_key < candidates[best_index].track_key)
            {
                best_score = score;
                best_index = index;
            }
        }

        let item = candidates.remove(best_index);
        *artist_counts
            .entry(catalog::normalize_text(&item.song.artist))
            .or_insert(0) += 1;
        *source_counts
            .entry(catalog::normalize_text(&item.song.source))
            .or_insert(0) += 1;
        selected.push(item);
    }

    selected
}

fn quota(limit: usize, ratio: f64) -> usize {
    ((limit as f64 * ratio).ceil() as usize).max(1)
}

fn is_within_quota(
    candidate: &Candidate,
    artist_counts: &HashMap<String, usize>,
    source_counts: &HashMap<String, usize>,
    artist_quota: usize,
    source_quota: usize,
) -> bool {
    let artist = catalog::normalize_text(&candidate.song.artist);
    let source = catalog::normalize_text(&candidate.song.source);
    (artist.is_empty() || artist_counts.get(&artist).copied().unwrap_or(0) < artist_quota)
        && (source.is_empty() || source_counts.get(&source).copied().unwrap_or(0) < source_quota)
}

pub fn to_items(
    candidates: Vec<Candidate>,
    request_id: &str,
    recommendation_source: &str,
) -> Vec<RecommendationItem> {
    candidates
        .into_iter()
        .map(|candidate| RecommendationItem {
            song: candidate.song,
            score: candidate.local_score.max(0.0),
            reasons: if candidate.reasons.is_empty() {
                vec!["来自你的本地资料库".to_string()]
            } else {
                candidate.reasons.into_iter().take(3).collect()
            },
            recommendation_source: recommendation_source.to_string(),
            request_id: request_id.to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::recommendation::model::RecSong;

    fn candidate(index: usize, artist: &str, source: &str, score: f64) -> Candidate {
        Candidate {
            track_key: format!("{source}:{index}"),
            song: RecSong {
                id: Value::from(index),
                source: source.to_string(),
                name: format!("歌曲 {index}"),
                artist: artist.to_string(),
                album: format!("专辑 {index}"),
                pic: None,
                pic_id: None,
                url_id: None,
                lyric_id: None,
                types: None,
            },
            local_score: score,
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
            last_seen_at: 0,
        }
    }

    #[test]
    fn artist_quota_stays_active_until_limit_is_filled() {
        let mut candidates = (0..4)
            .map(|index| candidate(index, "同一歌手", "netease", 1.0 - index as f64 * 0.01))
            .collect::<Vec<_>>();
        candidates.extend((4..8).map(|index| {
            candidate(
                index,
                &format!("歌手 {index}"),
                if index == 7 { "qq" } else { "netease" },
                0.8,
            )
        }));

        let selected = mmr(candidates, 4);
        let repeated_artist_count = selected
            .iter()
            .filter(|item| item.song.artist == "同一歌手")
            .count();

        assert_eq!(selected.len(), 4);
        assert_eq!(repeated_artist_count, 1);
    }

    #[test]
    fn source_quota_stays_active_when_alternatives_exist() {
        let mut candidates = (0..10)
            .map(|index| {
                candidate(
                    index,
                    &format!("歌手 {index}"),
                    "netease",
                    1.0 - index as f64 * 0.01,
                )
            })
            .collect::<Vec<_>>();
        candidates
            .extend((10..13).map(|index| candidate(index, &format!("歌手 {index}"), "qq", 0.5)));

        let selected = mmr(candidates, 10);
        let netease_count = selected
            .iter()
            .filter(|item| item.song.source == "netease")
            .count();

        assert_eq!(selected.len(), 10);
        assert_eq!(netease_count, 7);
    }
}
