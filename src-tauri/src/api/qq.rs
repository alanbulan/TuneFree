use crate::api::{ApiError, MusicProvider};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;

/// QQ Music unified gateway endpoint for vkey queries.
/// Public protocol constant; update if the upstream protocol changes.
const QQ_MUSICU_ENDPOINT: &str = "https://u.y.qq.com/cgi-bin/musicu.fcg";

/// Fallback stream host used when the vkey response omits `sip` entries.
/// Public protocol constant; update if the upstream protocol changes.
const QQ_DEFAULT_STREAM_BASE: &str = "https://ws.stream.qqmusic.qq.com/";

/// Rotating user-agent strings to avoid rate-limiting on QQ Music APIs.
const USER_AGENTS: [&str; 4] = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1",
    "Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:46.0) Gecko/20100101 Firefox/46.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36",
];

/// Selects a pseudo-random user-agent based on the current system time nanos.
fn get_random_user_agent() -> &'static str {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    USER_AGENTS[(nanos % USER_AGENTS.len() as u128) as usize]
}

fn build_qq_filename(songmid: &str, quality: &str) -> String {
    let (prefix, extension) = match quality {
        "320k" => ("M800", "mp3"),
        "flac" | "flac24bit" => ("F000", "flac"),
        _ => ("M500", "mp3"),
    };
    format!("{prefix}{songmid}{songmid}.{extension}")
}

fn parse_vkey_url(data: &Value) -> Result<String, ApiError> {
    let vkey_data = &data["queryvkey"]["data"];
    let purl = vkey_data["midurlinfo"][0]["purl"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ApiError::VipContent)?;

    if let Ok(url) = reqwest::Url::parse(purl) {
        if matches!(url.scheme(), "http" | "https") {
            return Ok(url.to_string());
        }
    }

    let base_url = vkey_data["sip"]
        .as_array()
        .and_then(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .find(|value| !value.trim().is_empty())
        })
        .unwrap_or(QQ_DEFAULT_STREAM_BASE);
    let base = reqwest::Url::parse(base_url)
        .map_err(|e| ApiError::Parse(format!("QQ Music invalid stream base URL: {e}")))?;
    let resolved = base
        .join(purl)
        .map_err(|e| ApiError::Parse(format!("QQ Music invalid stream path: {e}")))?;

    if !matches!(resolved.scheme(), "http" | "https") {
        return Err(ApiError::Parse(
            "QQ Music returned an unsupported stream URL scheme".to_string(),
        ));
    }

    Ok(resolved.to_string())
}

/// Unit-struct provider for the QQ Music (Tencent) platform.
pub struct QqProvider;

#[async_trait]
impl MusicProvider for QqProvider {
    fn platform(&self) -> &'static str {
        "qq"
    }

    async fn get_url(
        &self,
        client: &reqwest::Client,
        id: &str,
        quality: &str,
    ) -> Result<String, ApiError> {
        get_qq_url(client, id, quality).await
    }
}

/// Resolves a playable audio URL from QQ Music (Tencent).
///
/// Queries the QQ Music vkey API to obtain a `purl`, then constructs
/// the full streaming URL using HTTPS.
///
/// # Arguments
/// * `client` - Shared HTTP client.
/// * `songmid` - The QQ Music song mid (media ID).
/// * `quality` - "128k", "320k", "flac", or "flac24bit".
///
/// # Returns
/// Direct HTTPS audio URL on success, or `ApiError::VipContent` if the song
/// is VIP/copyright-protected.
pub async fn get_qq_url(client: &Client, songmid: &str, quality: &str) -> Result<String, ApiError> {
    let filename = build_qq_filename(songmid, quality);

    let data_param = serde_json::json!({
        "queryvkey": {
            "method": "CgiGetVkey",
            "module": "vkey.GetVkeyServer",
            "param": {
                "checklimit": 0,
                "ctx": 1,
                "downloadfrom": 0,
                "uin": "0",
                "filename": [filename],
                "guid": "0",
                "songmid": [songmid]
            }
        }
    })
    .to_string();

    let resp = client
        .get(QQ_MUSICU_ENDPOINT)
        .query(&[("data", &data_param)])
        .header("User-Agent", get_random_user_agent())
        .header("Origin", "https://y.qq.com")
        .header("Referer", "https://y.qq.com/portal/search.html")
        .send()
        .await?
        .error_for_status()?;

    let data: Value = resp.json().await?;
    parse_vkey_url(&data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_quality_specific_vkey_filenames() {
        assert_eq!(build_qq_filename("MID", "128k"), "M500MIDMID.mp3");
        assert_eq!(build_qq_filename("MID", "320k"), "M800MIDMID.mp3");
        assert_eq!(build_qq_filename("MID", "flac"), "F000MIDMID.flac");
        assert_eq!(build_qq_filename("MID", "flac24bit"), "F000MIDMID.flac");
    }

    #[test]
    fn resolves_relative_purl_against_first_sip() {
        let data = serde_json::json!({
            "queryvkey": {
                "data": {
                    "sip": ["https://cdn.example.com/base/"],
                    "midurlinfo": [{ "purl": "track/song.mp3?vkey=abc" }]
                }
            }
        });

        assert_eq!(
            parse_vkey_url(&data).unwrap(),
            "https://cdn.example.com/base/track/song.mp3?vkey=abc"
        );
    }

    #[test]
    fn keeps_absolute_purl() {
        let data = serde_json::json!({
            "queryvkey": {
                "data": {
                    "sip": ["https://unused.example.com/"],
                    "midurlinfo": [{ "purl": "https://audio.example.com/song.flac?token=1" }]
                }
            }
        });

        assert_eq!(
            parse_vkey_url(&data).unwrap(),
            "https://audio.example.com/song.flac?token=1"
        );
    }

    #[test]
    fn empty_purl_is_vip_content() {
        let data = serde_json::json!({
            "queryvkey": {
                "data": {
                    "sip": ["https://cdn.example.com/"],
                    "midurlinfo": [{ "purl": "" }]
                }
            }
        });

        assert!(matches!(parse_vkey_url(&data), Err(ApiError::VipContent)));
    }
}
