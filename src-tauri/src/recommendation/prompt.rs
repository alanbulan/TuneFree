use serde_json::json;

use super::{
    catalog,
    model::{ProfileToken, RecommendationItem, RecommendationQuery},
    privacy,
};

pub const SYSTEM_PROMPT: &str = "你是 TuneFree Desktop 的音乐推荐重排器。你只能基于用户提供的候选歌曲重新排序，不能编造候选之外的歌曲。你需要兼顾相关性、多样性、用户最近偏好、新歌探索和听歌场景。输出必须是合法 JSON，不要输出 Markdown，不要解释你的推理过程。";

pub const DISCOVERY_SYSTEM_PROMPT: &str = "你是 TuneFree Desktop 的音乐发现规划器。你不能输出最终歌曲列表，也不能编造歌曲 ID。你只能根据用户画像、本地候选和场景生成可用于真实音乐平台搜索的关键词。输出必须是合法 JSON，不要输出 Markdown，不要解释你的推理过程。";

pub fn build_messages(
    query: &RecommendationQuery,
    profile_tokens: &[ProfileToken],
    candidates: &[RecommendationItem],
    limit: usize,
) -> Vec<serde_json::Value> {
    let scene = if query.seed.is_some() {
        "similar"
    } else {
        "home"
    };
    let seed = query.seed.as_ref().map(|song| {
        json!({
            "track_key": catalog::track_key(song),
            "name": song.name,
            "artist": song.artist,
        })
    });
    let candidate_payload: Vec<_> = candidates
        .iter()
        .map(|item| {
            json!({
                "track_key": catalog::track_key(&item.song),
                "name": item.song.name,
                "artist": item.song.artist,
                "album": item.song.album,
                "source": item.song.source,
                "candidate_origin": item.recommendation_source,
                "local_score": item.score,
                "local_reasons": item.reasons,
            })
        })
        .collect();

    let user_payload = json!({
        "scene": scene,
        "limit": limit,
        "context": query.context,
        "profile_tokens": profile_tokens,
        "seed": seed,
        "candidates": candidate_payload,
        "rules": [
            "只能返回 candidates 中存在的 track_key",
            "不能编造歌曲、歌手、专辑",
            "reason 必须是 24 个中文字符以内的短句",
            "输出 JSON: {\"intent_tags\": string[], \"items\": [{\"track_key\": string, \"rank\": number, \"score\": number, \"reason\": string}], \"dropped\": []}"
        ]
    });

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
) -> Vec<serde_json::Value> {
    let scene = if query.seed.is_some() {
        "similar"
    } else {
        "home"
    };
    let seed = query.seed.as_ref().map(|song| {
        json!({
            "name": song.name,
            "artist": song.artist,
            "album": song.album,
            "source": song.source,
        })
    });
    let known_tracks: Vec<_> = local_candidates
        .iter()
        .take(40)
        .map(|item| {
            json!({
                "name": item.song.name,
                "artist": item.song.artist,
                "album": item.song.album,
                "source": item.song.source,
                "reasons": item.reasons,
            })
        })
        .collect();

    let user_payload = json!({
        "scene": scene,
        "limit": limit,
        "context": query.context,
        "profile_tokens": profile_tokens,
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
