use super::model::RecSong;

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

pub fn song_prompt_summary(song: &RecSong) -> serde_json::Value {
    serde_json::json!({
        "name": song.name,
        "artist": song.artist,
        "album": song.album,
        "source": song.source,
    })
}

#[cfg(test)]
mod tests {
    use super::validate_base_url;

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
}
