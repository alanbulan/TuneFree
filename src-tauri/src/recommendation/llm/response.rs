use std::collections::{HashMap, HashSet};

use serde::Deserialize;

use crate::recommendation::{
    catalog,
    model::{Candidate, RecommendationItem},
    prompt, rerank,
};

#[derive(Debug, Deserialize)]
struct LlmResponse {
    #[serde(default)]
    items: Vec<LlmResponseItem>,
}

#[derive(Debug, Deserialize)]
struct LlmResponseItem {
    track_key: String,
    rank: Option<usize>,
    score: Option<f64>,
    reason: Option<String>,
}

pub(super) fn apply_llm_response(
    content: &str,
    mut local_items: Vec<RecommendationItem>,
    limit: usize,
    request_id: &str,
) -> Option<Vec<RecommendationItem>> {
    let parsed: LlmResponse = super::json::extract_json(content)?;
    if parsed.items.is_empty() {
        return None;
    }

    normalize_item_scores(&mut local_items);
    let mut by_key: HashMap<String, RecommendationItem> = local_items
        .into_iter()
        .map(|item| (catalog::track_key(&item.song), item))
        .collect();
    let valid_keys: HashSet<_> = by_key.keys().cloned().collect();
    let unknown_count = parsed
        .items
        .iter()
        .filter(|item| !valid_keys.contains(&item.track_key))
        .count();
    if unknown_count > 0 && (unknown_count as f64 / parsed.items.len() as f64) > 0.2 {
        return None;
    }

    let mut selected = Vec::new();
    let total = parsed.items.len().max(1) as f64;
    for (index, llm_item) in parsed.items.into_iter().enumerate() {
        let Some(mut item) = by_key.remove(&llm_item.track_key) else {
            continue;
        };
        let rank_score = llm_rank_score(&llm_item, index, total);
        let explanation_confidence = if llm_item
            .reason
            .as_deref()
            .map(|reason| !reason.trim().is_empty())
            .unwrap_or(false)
        {
            1.0
        } else {
            0.0
        };
        item.score =
            (0.65 * item.score + 0.25 * rank_score + 0.10 * explanation_confidence).clamp(0.0, 1.0);
        item.recommendation_source = "hybrid".to_string();
        item.request_id = request_id.to_string();
        if let Some(reason) = prompt::item_reason(llm_item.reason.as_deref()) {
            item.reasons.insert(0, reason);
            item.reasons.truncate(3);
        }
        selected.push(candidate_from_item(item));
    }

    let mut rest: Vec<_> = by_key.into_values().collect();
    rest.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let remaining = rest.into_iter().map(candidate_from_item).collect();
    let candidates = rerank_selected_then_remaining(selected, remaining, limit);
    Some(rerank::to_items(candidates, request_id, "hybrid"))
}

fn normalize_item_scores(items: &mut [RecommendationItem]) {
    let max_score = items
        .iter()
        .filter_map(|item| item.score.is_finite().then_some(item.score.max(0.0)))
        .fold(0.0_f64, f64::max)
        .max(1.0);
    for item in items {
        item.score = if item.score.is_finite() {
            (item.score.max(0.0) / max_score).clamp(0.0, 1.0)
        } else {
            0.0
        };
    }
}

fn llm_rank_score(item: &LlmResponseItem, index: usize, total: f64) -> f64 {
    item.score
        .unwrap_or_else(|| {
            item.rank
                .map(|rank| 1.0 - ((rank.saturating_sub(1) as f64) / total))
                .unwrap_or_else(|| 1.0 - (index as f64 / total))
        })
        .clamp(0.0, 1.0)
}

fn candidate_from_item(item: RecommendationItem) -> Candidate {
    Candidate {
        track_key: catalog::track_key(&item.song),
        song: item.song,
        local_score: item.score,
        itemcf_score: 0.0,
        profile_score: 0.0,
        artist_match: 0.0,
        source_preference: 0.0,
        recent_penalty: 0.0,
        dismiss_penalty: 0.0,
        quality_bonus: 0.0,
        freshness_bonus: 0.0,
        diversity_seed_score: 0.0,
        reasons: item.reasons,
        last_seen_at: 0,
    }
}

fn rerank_selected_then_remaining(
    selected: Vec<Candidate>,
    remaining: Vec<Candidate>,
    limit: usize,
) -> Vec<Candidate> {
    let selected_limit = selected.len().min(limit);
    let mut result = rerank::mmr(selected, selected_limit);
    if result.len() < limit {
        result.extend(rerank::mmr(remaining, limit - result.len()));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recommendation::model::RecSong;
    use serde_json::Value;

    fn item(id: &str, score: f64) -> RecommendationItem {
        RecommendationItem {
            song: RecSong {
                id: Value::String(id.to_string()),
                source: "netease".to_string(),
                name: format!("歌曲 {id}"),
                artist: format!("歌手 {id}"),
                album: format!("专辑 {id}"),
                pic: None,
                pic_id: None,
                url_id: None,
                lyric_id: None,
                types: None,
            },
            score,
            reasons: Vec::new(),
            recommendation_source: "local".to_string(),
            request_id: "local-request".to_string(),
        }
    }

    #[test]
    fn llm_selected_item_precedes_unselected_item_with_higher_raw_score() {
        let local_items = vec![item("unselected", 3.745), item("selected", 0.1)];
        let content = r#"{"items":[{"track_key":"netease:selected","rank":1,"score":0.0}]}"#;
        let items = apply_llm_response(content, local_items, 2, "request").unwrap();
        assert_eq!(catalog::track_key(&items[0].song), "netease:selected");
        assert!(items.iter().all(|item| (0.0..=1.0).contains(&item.score)));
    }

    #[test]
    fn accepts_fenced_response_and_response_with_surrounding_prose() {
        let fenced = "```json\n{\"items\":[{\"track_key\":\"netease:a\",\"rank\":1}]}\n```";
        let prose = "重排结果如下：\n{\"items\":[{\"track_key\":\"netease:a\",\"rank\":1}]}\n完毕";
        for content in [fenced, prose] {
            let items =
                apply_llm_response(content, vec![item("a", 0.9), item("b", 0.5)], 2, "request")
                    .unwrap();
            assert_eq!(catalog::track_key(&items[0].song), "netease:a");
        }
    }

    #[test]
    fn rejects_truncated_response() {
        let content = "```json\n{\"items\":[{\"track_key\":\"netease:a\"";
        assert!(apply_llm_response(content, vec![item("a", 0.9)], 1, "request").is_none());
    }
}
