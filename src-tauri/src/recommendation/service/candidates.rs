use super::jobs::new_request_id;
use super::*;

impl RecommendationService {
    pub fn similar_songs(
        &self,
        song: RecSong,
        limit: Option<usize>,
    ) -> CommandResult<Vec<RecommendationItem>> {
        self.db_handle()?;
        let query = RecommendationQuery {
            limit,
            seed: Some(song),
            context: Some("similar".to_string()),
        };
        self.local_recommendations(&query, "local")
            .map_err(CommandError::database)
    }

    pub(super) fn local_recommendations(
        &self,
        query: &RecommendationQuery,
        recommendation_source: &str,
    ) -> Result<Vec<RecommendationItem>, String> {
        let handle = self.conn_handle().map_err(|error| error.message.clone())?;
        let request_id = new_request_id();
        // SQL 召回与排序在锁内完成；MMR 重排等纯计算移到锁外，
        // 缩短全局连接锁的持有时间。
        let candidates = {
            let conn = handle.lock();
            if let Some(seed) = &query.seed {
                catalog::upsert_track(&conn, seed)
                    .map_err(|e| format!("保存相似推荐种子失败: {}", e))?;
            }
            let mut candidates = recall::collect_candidates(&conn, query.seed.as_ref(), 500)
                .map_err(|e| format!("召回推荐候选失败: {}", e))?;
            if let Some(seed) = query.seed.as_ref() {
                candidates.retain(|candidate| !is_seed_song(&candidate.song, seed));
            }
            rank::rank_candidates(&conn, candidates, query.seed.as_ref())
                .map_err(|e| format!("推荐排序失败: {}", e))?
        };
        let limit = query.limit.unwrap_or(30).clamp(1, 50);
        let candidates = rerank::mmr(candidates, limit);
        Ok(rerank::to_items(
            candidates,
            &request_id,
            recommendation_source,
        ))
    }
}

pub(super) fn merge_discovery_candidates(
    local_items: Vec<RecommendationItem>,
    discovered: Vec<discovery::DiscoveredSong>,
    request_id: &str,
    llm_candidate_window: usize,
    seed: Option<&RecSong>,
) -> Vec<RecommendationItem> {
    let discovery_items = discovered
        .into_iter()
        .map(|item| discovery_item(item, request_id))
        .collect::<Vec<_>>();
    let candidate_window = llm_candidate_window.clamp(1, MERGED_CANDIDATE_LIMIT);
    let discovery_target = discovery_window_target(candidate_window, discovery_items.len());
    let local_anchor = local_anchor_limit(candidate_window, discovery_target);
    let mut merger = CandidateMerger::default();
    merger.extend(local_items.iter().take(local_anchor).cloned());
    merger.extend(discovery_items.iter().take(discovery_target).cloned());
    merger.extend(
        local_items
            .iter()
            .skip(local_anchor)
            .take(LOCAL_HEAD_CANDIDATE_LIMIT.saturating_sub(local_anchor))
            .cloned(),
    );
    merger.extend(discovery_items.into_iter().skip(discovery_target));
    merger.extend(local_items.into_iter().skip(LOCAL_HEAD_CANDIDATE_LIMIT));

    let mut merged = merger.items;
    if let Some(seed) = seed {
        merged.retain(|item| !is_seed_song(&item.song, seed));
    }

    merged
}

fn discovery_item(item: discovery::DiscoveredSong, request_id: &str) -> RecommendationItem {
    RecommendationItem {
        song: item.song,
        score: 0.45,
        reasons: vec![
            discovery::discovery_reason(&item.reason),
            "平台搜索验证".to_string(),
        ],
        recommendation_source: "discovery".to_string(),
        request_id: request_id.to_string(),
    }
}

fn discovery_window_target(candidate_window: usize, discovery_count: usize) -> usize {
    if discovery_count == 0 {
        0
    } else {
        (candidate_window / 2).max(1).min(discovery_count)
    }
}

fn local_anchor_limit(candidate_window: usize, discovery_target: usize) -> usize {
    if discovery_target == 0 {
        LOCAL_HEAD_CANDIDATE_LIMIT.min(candidate_window)
    } else {
        candidate_window
            .saturating_sub(discovery_target)
            .min(LOCAL_HEAD_CANDIDATE_LIMIT)
    }
}

pub(super) fn is_seed_song(song: &RecSong, seed: &RecSong) -> bool {
    catalog::track_key(song) == catalog::track_key(seed)
        || catalog::song_identity(song) == catalog::song_identity(seed)
}

#[derive(Default)]
struct CandidateMerger {
    items: Vec<RecommendationItem>,
    track_keys: HashSet<String>,
    identities: HashSet<String>,
}

impl CandidateMerger {
    fn extend(&mut self, items: impl IntoIterator<Item = RecommendationItem>) {
        for item in items {
            if self.items.len() >= MERGED_CANDIDATE_LIMIT {
                break;
            }
            let track_key = catalog::track_key(&item.song);
            let identity = catalog::song_identity(&item.song);
            if self.track_keys.insert(track_key) && self.identities.insert(identity) {
                self.items.push(item);
            }
        }
    }
}
