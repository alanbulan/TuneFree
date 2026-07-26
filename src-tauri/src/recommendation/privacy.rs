//! Single audited place deciding which fields may leave the device in
//! cloud LLM requests. Anything not selected here (song ids beyond the
//! track key, pic/url/lyric identifiers, request ids, session data) must
//! stay local. `prompt.rs` builds messages exclusively from these views.

use serde_json::{json, Value};

use super::{
    catalog,
    model::{ProfileToken, RecSong, RecentEventSummary, RecommendationItem},
};

pub fn sanitize_base_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}

pub fn validate_base_url(input: &str) -> Result<String, String> {
    let normalized = sanitize_base_url(input);
    let url = reqwest::Url::parse(&normalized).map_err(|_| "API 根地址格式无效".to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "API 根地址缺少主机名".to_string())?;
    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if url.scheme() != "https" && !(url.scheme() == "http" && is_loopback) {
        return Err("API 根地址必须使用 HTTPS；仅本机回环地址允许 HTTP".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("API 根地址不能包含用户名或密码".to_string());
    }
    Ok(normalized)
}

pub fn short_reason(input: &str) -> String {
    input.trim().chars().take(24).collect::<String>()
}

/// Seed fields uploaded for cloud rerank; the track key is required so the
/// model can reference candidates by key.
pub fn redact_rerank_seed(song: &RecSong) -> Value {
    json!({
        "track_key": catalog::track_key(song),
        "name": song.name,
        "artist": song.artist,
    })
}

/// Seed fields uploaded for discovery planning; no ids are needed there.
pub fn redact_discovery_seed(song: &RecSong) -> Value {
    json!({
        "name": song.name,
        "artist": song.artist,
        "album": song.album,
        "source": song.source,
    })
}

/// Candidate fields uploaded for cloud rerank.
pub fn redact_candidate(item: &RecommendationItem) -> Value {
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
}

/// Known-track fields uploaded for discovery planning.
pub fn redact_known_track(item: &RecommendationItem) -> Value {
    json!({
        "name": item.song.name,
        "artist": item.song.artist,
        "album": item.song.album,
        "source": item.song.source,
        "reasons": item.reasons,
    })
}

/// Profile tokens are uploaded as `{key, value}` pairs only.
pub fn redact_profile(tokens: &[ProfileToken]) -> Value {
    json!(tokens)
}

/// Recent events are uploaded as pre-summarized rows (no session ids,
/// timestamps or positions — see `RecentEventSummary`).
pub fn redact_recent_events(events: &[RecentEventSummary]) -> Value {
    json!(events)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn requires_https_except_for_loopback() {
        assert!(validate_base_url("https://api.example.com/v1/").is_ok());
        assert!(validate_base_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
        assert!(validate_base_url("http://api.example.com/v1").is_err());
    }

    #[test]
    fn rejects_credentials_and_invalid_urls() {
        assert!(validate_base_url("https://user:pass@example.com/v1").is_err());
        assert!(validate_base_url("not-a-url").is_err());
    }

    fn item() -> RecommendationItem {
        RecommendationItem {
            song: RecSong {
                id: json!(42),
                source: "netease".to_string(),
                name: "歌曲".to_string(),
                artist: "歌手".to_string(),
                album: "专辑".to_string(),
                pic: Some("secret-pic-url".to_string()),
                pic_id: Some("secret-pic-id".to_string()),
                url_id: Some("secret-url-id".to_string()),
                lyric_id: Some("secret-lyric-id".to_string()),
                types: Some(vec!["flac".to_string()]),
            },
            score: 0.7,
            reasons: vec!["理由".to_string()],
            recommendation_source: "local".to_string(),
            request_id: "secret-request-id".to_string(),
        }
    }

    #[test]
    fn candidate_redaction_only_exposes_allowed_fields() {
        for redacted in [redact_candidate(&item()), redact_known_track(&item())] {
            let allowed = [
                "track_key",
                "name",
                "artist",
                "album",
                "source",
                "candidate_origin",
                "local_score",
                "local_reasons",
                "reasons",
            ];
            for key in redacted.as_object().unwrap().keys() {
                assert!(allowed.contains(&key.as_str()), "不允许上传字段 {key}");
            }
            assert!(!redacted.to_string().contains("secret"));
        }
    }

    #[test]
    fn seed_redaction_never_exposes_media_identifiers() {
        let song = item().song;
        for redacted in [redact_rerank_seed(&song), redact_discovery_seed(&song)] {
            assert!(!redacted.to_string().contains("secret"));
        }
    }
}
