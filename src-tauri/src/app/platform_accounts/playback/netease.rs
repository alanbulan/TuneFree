//! URL v1 level protocol from NeteaseCloudMusicApiEnhanced (MIT), pinned in docs.
use super::{playback_url, quality_ladder};
use crate::app::{
    error::{CommandError, CommandResult},
    platform_accounts::{http, model::*},
};
use reqwest::Client;
use serde_json::json;

pub(super) async fn resolve(
    client: &Client,
    session: &Session,
    id: &str,
    quality: &str,
    rejected: &[String],
) -> CommandResult<Option<(String, String)>> {
    numeric_id(id)?;
    for quality in quality_ladder(quality)? {
        let level = match *quality {
            "flac24bit" => "hires",
            "flac" => "lossless",
            "320k" => "exhigh",
            _ => "standard",
        };
        let payload =
            json!({"ids":format!("[{id}]"),"level":level,"encodeType":"flac"}).to_string();
        let params =
            crate::api::netease::eapi_parameters("/api/song/enhance/player/url/v1", &payload);
        let response = client
            .post("https://interface3.music.163.com/eapi/song/enhance/player/url/v1")
            .header("Cookie", format!("{}; os=pc; appver=3.1.3", session.cookie))
            .header("Referer", "https://music.163.com/")
            .header("User-Agent", "Mozilla/5.0")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!("params={params}"))
            .send()
            .await
            .map_err(|_| CommandError::network("网易云账号解析失败，请稍后重试"))?;
        let data = http::read_response(response).await?;
        http::check_netease(&data)?;
        let row = data["data"]
            .as_array()
            .and_then(|rows| rows.first())
            .ok_or_else(invalid_response)?;
        if value_string(&row["id"]).as_deref() != Some(id) {
            return Err(invalid_response());
        }
        // A trial clip is not a full playback grant.
        if row["freeTrialInfo"].is_object() || row["code"].as_i64().is_some_and(|code| code != 200)
        {
            continue;
        }
        if let Some(raw) = row["url"].as_str().filter(|url| !url.is_empty()) {
            let url = playback_url(Platform::Netease, raw)?;
            if rejected.contains(&url) {
                continue;
            }
            let actual = match row["level"].as_str() {
                Some("hires" | "jyeffect" | "jymaster") => "flac24bit",
                Some("lossless") => "flac",
                Some("exhigh") => "320k",
                Some("standard" | "higher") => "128k",
                _ => quality,
            };
            return Ok(Some((url, actual.to_string())));
        }
    }
    Ok(None)
}
