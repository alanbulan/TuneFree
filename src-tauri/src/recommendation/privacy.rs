use super::model::RecSong;

pub fn sanitize_base_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}

pub fn short_reason(input: &str) -> String {
    input.trim().chars().take(24).collect::<String>()
}

pub fn song_prompt_summary(song: &RecSong) -> serde_json::Value {
    serde_json::json!({
        "name": song.name,
        "artist": song.artist,
        "album": song.album,
        "source": song.source,
    })
}
