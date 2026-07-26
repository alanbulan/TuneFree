use std::collections::{HashMap, HashSet};

use super::{
    catalog,
    model::{Candidate, RecommendationItem},
};

const MMR_LAMBDA: f64 = 0.78;

/// Normalized text features computed once per candidate so the MMR loop
/// avoids re-running `normalize_text`/`split_tokens` for every pair.
struct CandidateFeatures {
    artist: String,
    album: String,
    source: String,
    name_tokens: HashSet<String>,
}

impl CandidateFeatures {
    fn new(candidate: &Candidate) -> Self {
        Self {
            artist: catalog::normalize_text(&candidate.song.artist),
            album: catalog::normalize_text(&candidate.song.album),
            source: catalog::normalize_text(&candidate.song.source),
            name_tokens: catalog::split_tokens(&candidate.song.name)
                .into_iter()
                .collect(),
        }
    }
}

/// Same scoring as `catalog::content_similarity`, on precomputed features.
fn feature_similarity(a: &CandidateFeatures, b: &CandidateFeatures) -> f64 {
    let mut score: f64 = 0.0;
    if !a.artist.is_empty() && a.artist == b.artist {
        score = score.max(0.8);
    }
    if !a.album.is_empty() && a.album == b.album {
        score = score.max(0.6);
    }
    if a.source == b.source {
        score = score.max(0.15);
    }
    if !a.name_tokens.is_empty() && !b.name_tokens.is_empty() {
        let overlap = a.name_tokens.intersection(&b.name_tokens).count() as f64;
        let denom = (a.name_tokens.len() + b.name_tokens.len()) as f64 - overlap;
        if denom > 0.0 {
            score = score.max((overlap / denom) * 0.3);
        }
    }

    score.clamp(0.0, 1.0)
}

pub fn mmr(mut candidates: Vec<Candidate>, limit: usize) -> Vec<Candidate> {
    let mut features: Vec<CandidateFeatures> =
        candidates.iter().map(CandidateFeatures::new).collect();
    // 每个候选与已选集合的最大相似度，按轮增量维护：每轮只需与新入选项
    // 比较一次，把复杂度从 O(n·k²) 降到 O(n·k)。
    let mut max_similarity = vec![0.0_f64; candidates.len()];
    let mut selected: Vec<Candidate> = Vec::new();
    let mut artist_counts: HashMap<String, usize> = HashMap::new();
    let mut source_counts: HashMap<String, usize> = HashMap::new();
    let artist_quota = quota(limit, 0.25);
    let source_quota = quota(limit, 0.70);

    while !candidates.is_empty() && selected.len() < limit {
        let has_candidate_within_quota = features.iter().any(|feature| {
            is_within_quota(
                feature,
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
                    &features[index],
                    &artist_counts,
                    &source_counts,
                    artist_quota,
                    source_quota,
                )
            {
                continue;
            }
            let score =
                MMR_LAMBDA * candidate.local_score - (1.0 - MMR_LAMBDA) * max_similarity[index];
            if score > best_score
                || (score == best_score && candidate.track_key < candidates[best_index].track_key)
            {
                best_score = score;
                best_index = index;
            }
        }

        let item = candidates.remove(best_index);
        let item_features = features.remove(best_index);
        max_similarity.remove(best_index);
        *artist_counts
            .entry(item_features.artist.clone())
            .or_insert(0) += 1;
        *source_counts
            .entry(item_features.source.clone())
            .or_insert(0) += 1;
        for (max_value, feature) in max_similarity.iter_mut().zip(&features) {
            *max_value = max_value.max(feature_similarity(&item_features, feature));
        }
        selected.push(item);
    }

    selected
}

fn quota(limit: usize, ratio: f64) -> usize {
    ((limit as f64 * ratio).ceil() as usize).max(1)
}

fn is_within_quota(
    features: &CandidateFeatures,
    artist_counts: &HashMap<String, usize>,
    source_counts: &HashMap<String, usize>,
    artist_quota: usize,
    source_quota: usize,
) -> bool {
    (features.artist.is_empty()
        || artist_counts.get(&features.artist).copied().unwrap_or(0) < artist_quota)
        && (features.source.is_empty()
            || source_counts.get(&features.source).copied().unwrap_or(0) < source_quota)
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

    fn full_candidate(
        index: usize,
        artist: &str,
        album: &str,
        source: &str,
        name: &str,
        score: f64,
    ) -> Candidate {
        let mut candidate = candidate(index, artist, source, score);
        candidate.song.album = album.to_string();
        candidate.song.name = name.to_string();
        candidate
    }

    /// 优化前的逐对全量实现，仅用于断言优化后的选择结果一致。
    fn reference_mmr(mut candidates: Vec<Candidate>, limit: usize) -> Vec<Candidate> {
        let mut selected: Vec<Candidate> = Vec::new();
        let mut artist_counts: HashMap<String, usize> = HashMap::new();
        let mut source_counts: HashMap<String, usize> = HashMap::new();
        let artist_quota = quota(limit, 0.25);
        let source_quota = quota(limit, 0.70);
        let within = |candidate: &Candidate,
                      artist_counts: &HashMap<String, usize>,
                      source_counts: &HashMap<String, usize>| {
            let artist = catalog::normalize_text(&candidate.song.artist);
            let source = catalog::normalize_text(&candidate.song.source);
            (artist.is_empty() || artist_counts.get(&artist).copied().unwrap_or(0) < artist_quota)
                && (source.is_empty()
                    || source_counts.get(&source).copied().unwrap_or(0) < source_quota)
        };

        while !candidates.is_empty() && selected.len() < limit {
            let has_within = candidates
                .iter()
                .any(|candidate| within(candidate, &artist_counts, &source_counts));
            let mut best_index = 0;
            let mut best_score = f64::MIN;
            for (index, candidate) in candidates.iter().enumerate() {
                if has_within && !within(candidate, &artist_counts, &source_counts) {
                    continue;
                }
                let max_similarity = selected
                    .iter()
                    .map(|item| catalog::content_similarity(&item.song, &candidate.song))
                    .fold(0.0_f64, f64::max);
                let score =
                    MMR_LAMBDA * candidate.local_score - (1.0 - MMR_LAMBDA) * max_similarity;
                if score > best_score
                    || (score == best_score
                        && candidate.track_key < candidates[best_index].track_key)
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

    #[test]
    fn incremental_mmr_matches_pairwise_reference_selection() {
        let candidates: Vec<Candidate> = (0..40)
            .map(|index| {
                let artist = ["周杰伦", "林俊杰", "", "Taylor Swift"][index % 4];
                let album = ["叶惠美", "第二天堂", "共享专辑"][index % 3];
                let source = ["netease", "qq", "kuwo"][index % 3];
                let name = match index % 5 {
                    0 => "晴天 (Live)".to_string(),
                    1 => "晴天".to_string(),
                    2 => format!("夜曲 remix {index}"),
                    3 => format!("song of rain {index}"),
                    _ => format!("孤独患者 {index}"),
                };
                let score = ((index % 7) as f64) * 0.13 + ((index % 3) as f64) * 0.01;
                full_candidate(index, artist, album, source, &name, score)
            })
            .collect();

        for limit in [1, 5, 10, 40, 50] {
            let expected: Vec<_> = reference_mmr(candidates.clone(), limit)
                .into_iter()
                .map(|candidate| candidate.track_key)
                .collect();
            let actual: Vec<_> = mmr(candidates.clone(), limit)
                .into_iter()
                .map(|candidate| candidate.track_key)
                .collect();
            assert_eq!(actual, expected, "limit {limit} 的选择结果应与优化前一致");
        }
    }

    #[test]
    fn mmr_handles_degenerate_limits_and_is_deterministic() {
        let candidates: Vec<Candidate> = (0..5)
            .map(|index| candidate(index, &format!("歌手 {index}"), "netease", 0.5))
            .collect();

        assert!(mmr(Vec::new(), 5).is_empty());
        assert!(mmr(candidates.clone(), 0).is_empty());
        // limit 超过候选数时全部返回，不得 panic 或截断。
        assert_eq!(mmr(candidates.clone(), 99).len(), 5);
        // 全同分时按 track_key 稳定排序，两次调用结果必须一致。
        let first: Vec<_> = mmr(candidates.clone(), 3)
            .into_iter()
            .map(|item| item.track_key)
            .collect();
        let second: Vec<_> = mmr(candidates, 3)
            .into_iter()
            .map(|item| item.track_key)
            .collect();
        assert_eq!(first, second);
    }

    #[test]
    fn to_items_supplies_a_default_reason_and_caps_the_list() {
        let mut plain = candidate(1, "歌手", "netease", -0.4);
        plain.reasons = Vec::new();
        let mut verbose = candidate(2, "歌手", "netease", 0.7);
        verbose.reasons = (0..5).map(|index| format!("理由 {index}")).collect();

        let items = to_items(vec![plain, verbose], "req-1", "hybrid");

        assert_eq!(items[0].reasons, vec!["来自你的本地资料库".to_string()]);
        // 负分不能传给前端的进度条式展示。
        assert_eq!(items[0].score, 0.0);
        assert_eq!(items[1].reasons.len(), 3);
        assert_eq!(items[1].reasons[0], "理由 0");
        assert!(items
            .iter()
            .all(|item| item.request_id == "req-1" && item.recommendation_source == "hybrid"));
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
