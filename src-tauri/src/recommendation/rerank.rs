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

    while !candidates.is_empty() && selected.len() < limit {
        let mut best_index = 0;
        let mut best_score = f64::MIN;
        for (index, candidate) in candidates.iter().enumerate() {
            let max_similarity = selected
                .iter()
                .map(|item| catalog::content_similarity(&item.song, &candidate.song))
                .fold(0.0_f64, f64::max);
            let artist = catalog::normalize_text(&candidate.song.artist);
            let source = catalog::normalize_text(&candidate.song.source);
            let artist_quota = ((limit as f64) * 0.25).ceil() as usize;
            let source_quota = ((limit as f64) * 0.70).ceil() as usize;
            let quota_penalty = if artist_counts.get(&artist).copied().unwrap_or(0) >= artist_quota
                && candidates.len() > limit
            {
                0.35
            } else {
                0.0
            } + if source_counts.get(&source).copied().unwrap_or(0)
                >= source_quota
                && candidates.len() > limit
            {
                0.15
            } else {
                0.0
            };
            let score =
                lambda * candidate.local_score - (1.0 - lambda) * max_similarity - quota_penalty;
            if score > best_score {
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
