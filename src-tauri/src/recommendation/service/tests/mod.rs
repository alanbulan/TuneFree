mod candidates;
mod feedback;
mod jobs;
mod library;
mod storage;

use serde_json::Value;

use super::*;
use crate::recommendation::model::{PlaylistSnapshot, RecommendationEvent};

fn song(source: &str, id: &str, name: &str, artist: &str) -> RecSong {
    RecSong {
        id: Value::String(id.to_string()),
        source: source.to_string(),
        name: name.to_string(),
        artist: artist.to_string(),
        album: "测试专辑".to_string(),
        pic: None,
        pic_id: None,
        url_id: None,
        lyric_id: None,
        types: None,
    }
}

fn recommendation_item(source: &str, id: &str, name: &str) -> RecommendationItem {
    RecommendationItem {
        song: RecSong {
            id: Value::String(id.to_string()),
            source: source.to_string(),
            name: name.to_string(),
            artist: "测试歌手".to_string(),
            album: "测试专辑".to_string(),
            pic: None,
            pic_id: None,
            url_id: None,
            lyric_id: None,
            types: None,
        },
        score: 0.8,
        reasons: vec!["本地候选".to_string()],
        recommendation_source: "local".to_string(),
        request_id: "req-test".to_string(),
    }
}

fn discovered_song(id: &str, name: &str) -> discovery::DiscoveredSong {
    discovery::DiscoveredSong {
        song: RecSong {
            id: Value::String(id.to_string()),
            source: "netease".to_string(),
            name: name.to_string(),
            artist: "新歌手".to_string(),
            album: "新专辑".to_string(),
            pic: None,
            pic_id: None,
            url_id: None,
            lyric_id: None,
            types: None,
        },
        reason: "云端发现".to_string(),
    }
}
