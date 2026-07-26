use serde_json::json;

use super::{
    model::{ProfileToken, RecentEventSummary, RecommendationItem, RecommendationQuery},
    privacy,
};

pub const SYSTEM_PROMPT: &str = "你是 TuneFree Desktop 的音乐推荐重排器。你只能基于用户提供的候选歌曲重新排序，不能编造候选之外的歌曲。你需要兼顾相关性、多样性、用户最近偏好、新歌探索和听歌场景。输出必须是合法 JSON，不要输出 Markdown，不要解释你的推理过程。";

pub const DISCOVERY_SYSTEM_PROMPT: &str = "你是 TuneFree Desktop 的音乐发现规划器。你不能输出最终歌曲列表，也不能编造歌曲 ID。你只能根据用户画像、本地候选和场景生成可用于真实音乐平台搜索的关键词。输出必须是合法 JSON，不要输出 Markdown，不要解释你的推理过程。";
pub const PROMPT_SCHEMA_VERSION: u32 = 2;

pub fn build_messages(
    query: &RecommendationQuery,
    profile_tokens: &[ProfileToken],
    candidates: &[RecommendationItem],
    limit: usize,
    recent_events: Option<&[RecentEventSummary]>,
) -> Vec<serde_json::Value> {
    let scene = if query.seed.is_some() {
        "similar"
    } else {
        "home"
    };
    let seed = query.seed.as_ref().map(privacy::redact_rerank_seed);
    let candidate_payload: Vec<_> = candidates.iter().map(privacy::redact_candidate).collect();

    let mut user_payload = json!({
        "scene": scene,
        "limit": limit,
        "context": query.context,
        "profile_tokens": privacy::redact_profile(profile_tokens),
        "seed": seed,
        "candidates": candidate_payload,
        "rules": [
            "只能返回 candidates 中存在的 track_key",
            "不能编造歌曲、歌手、专辑",
            "reason 必须是 24 个中文字符以内的短句",
            "输出 JSON: {\"intent_tags\": string[], \"items\": [{\"track_key\": string, \"rank\": number, \"score\": number, \"reason\": string}], \"dropped\": []}"
        ]
    });
    if let Some(recent_events) = recent_events {
        user_payload
            .as_object_mut()
            .expect("推荐提示词必须是 JSON 对象")
            .insert(
                "recent_events".to_string(),
                privacy::redact_recent_events(recent_events),
            );
    }

    vec![
        json!({ "role": "system", "content": SYSTEM_PROMPT }),
        json!({ "role": "user", "content": user_payload.to_string() }),
    ]
}

pub fn build_discovery_messages(
    query: &RecommendationQuery,
    profile_tokens: &[ProfileToken],
    local_candidates: &[RecommendationItem],
    limit: usize,
    recent_events: Option<&[RecentEventSummary]>,
) -> Vec<serde_json::Value> {
    let scene = if query.seed.is_some() {
        "similar"
    } else {
        "home"
    };
    let seed = query.seed.as_ref().map(privacy::redact_discovery_seed);
    let known_tracks: Vec<_> = local_candidates
        .iter()
        .take(40)
        .map(privacy::redact_known_track)
        .collect();

    let mut user_payload = json!({
        "scene": scene,
        "limit": limit,
        "context": query.context,
        "profile_tokens": privacy::redact_profile(profile_tokens),
        "seed": seed,
        "known_tracks": known_tracks,
        "rules": [
            "只输出搜索关键词，不输出最终歌曲列表",
            "关键词必须适合在网易云、QQ音乐、酷我音乐搜索",
            "搜索方向要包含用户偏好的相近音乐，也要包含少量新鲜探索",
            "避免只复述 known_tracks 中的歌名",
            "如果画像或已知歌曲为空，生成可在平台稳定搜到的中文流行、独立、电子、民谣、影视原声等发现方向",
            "每个 keyword 不超过 24 个中文字符或 8 个英文单词",
            "source 只能是 netease、qq、kuwo、all",
            "输出 JSON: {\"intent_tags\": string[], \"queries\": [{\"keyword\": string, \"source\": string, \"reason\": string}]}"
        ]
    });
    if let Some(recent_events) = recent_events {
        user_payload
            .as_object_mut()
            .expect("发现提示词必须是 JSON 对象")
            .insert(
                "recent_events".to_string(),
                privacy::redact_recent_events(recent_events),
            );
    }

    vec![
        json!({ "role": "system", "content": DISCOVERY_SYSTEM_PROMPT }),
        json!({ "role": "user", "content": user_payload.to_string() }),
    ]
}

pub fn item_reason(reason: Option<&str>) -> Option<String> {
    reason
        .map(privacy::short_reason)
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recommendation::model::RecSong;

    fn query() -> RecommendationQuery {
        RecommendationQuery {
            limit: Some(10),
            seed: None,
            context: Some("home".to_string()),
        }
    }

    fn user_payload(messages: Vec<serde_json::Value>) -> serde_json::Value {
        serde_json::from_str(messages[1]["content"].as_str().unwrap()).unwrap()
    }

    #[test]
    fn recent_events_are_only_added_when_explicitly_enabled() {
        let summary = RecentEventSummary {
            event_type: "play_complete".to_string(),
            song_name: "测试歌曲".to_string(),
            artist: "测试歌手".to_string(),
            age_bucket: "today".to_string(),
        };
        let without_events = user_payload(build_messages(&query(), &[], &[], 10, None));
        let with_events = user_payload(build_messages(
            &query(),
            &[],
            &[],
            10,
            Some(std::slice::from_ref(&summary)),
        ));

        assert!(without_events.get("recent_events").is_none());
        assert_eq!(with_events["recent_events"][0]["songName"], "测试歌曲");
        assert!(with_events["recent_events"][0].get("sessionId").is_none());
    }

    #[test]
    fn messages_never_leak_private_song_fields() {
        let song = RecSong {
            id: serde_json::json!(42),
            source: "netease".to_string(),
            name: "歌曲".to_string(),
            artist: "歌手".to_string(),
            album: "专辑".to_string(),
            pic: Some("secret-pic-url".to_string()),
            pic_id: Some("secret-pic-id".to_string()),
            url_id: Some("secret-url-id".to_string()),
            lyric_id: Some("secret-lyric-id".to_string()),
            types: Some(vec!["flac".to_string()]),
        };
        let item = RecommendationItem {
            song: song.clone(),
            score: 0.7,
            reasons: vec!["理由".to_string()],
            recommendation_source: "local".to_string(),
            request_id: "secret-request-id".to_string(),
        };
        let seeded_query = RecommendationQuery {
            limit: Some(10),
            seed: Some(song),
            context: Some("similar".to_string()),
        };
        let candidates = vec![item];

        let rerank = build_messages(&seeded_query, &[], &candidates, 10, None);
        let discovery = build_discovery_messages(&seeded_query, &[], &candidates, 5, None);

        for messages in [rerank, discovery] {
            let raw = serde_json::to_string(&messages).unwrap();
            assert!(!raw.contains("secret"), "消息中不得包含私有字段: {raw}");
        }
    }
}
