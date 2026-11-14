//! Official web playback with the account Cookie; signatures adapted from TuneWeave (MIT).
use super::{playback_url, quality_ladder};
use crate::app::{
    error::{CommandError, CommandResult},
    platform_accounts::{cookies, http, kuwo, model::*},
};
use reqwest::Client;
use serde_json::Value;

fn secret(cookie: &str) -> CommandResult<String> {
    let value = cookies::value(cookie, cookies::KUWO_WEB_COOKIE).ok_or_else(auth_required)?;
    let mut random = [0_u8; 4];
    getrandom::fill(&mut random).map_err(|_| CommandError::internal("无法建立酷我播放请求"))?;
    secret_for_nonce(
        value,
        10_000_000 + u64::from(u32::from_le_bytes(random)) % 90_000_000,
    )
}

fn secret_for_nonce(value: &str, nonce: u64) -> CommandResult<String> {
    if !(16..=128).contains(&value.len()) || !value.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err(CommandError::network("酷我网页会话不完整，请重新登录"));
    }
    let mut state = (9_253_u64 * 59_910_100 + 23) % 2_147_483_647;
    let mut result = String::new();
    for byte in value.bytes() {
        result.push_str(&format!(
            "{:02x}",
            u64::from(byte) ^ (state * 255 / 2_147_483_647)
        ));
        state = (9_253 * state + 23) % 2_147_483_647;
    }
    result.push_str(&format!("{nonce:08x}"));
    Ok(result)
}

fn trial(row: &Value) -> bool {
    row["isTrial"].as_bool() == Some(true)
        || row["freeTrialInfo"].is_object()
        || ["audioFlags", "trialDuration"]
            .iter()
            .any(|key| integer(&row[key]).is_some_and(|value| value > 0))
}

fn actual_quality(row: &Value, url: &str) -> &'static str {
    let format = row["format"]
        .as_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let flac = format == "flac"
        || url::Url::parse(url)
            .ok()
            .is_some_and(|url| url.path().to_ascii_lowercase().ends_with(".flac"));
    if flac {
        return if integer(&row["bitDepth"]).is_some_and(|depth| depth >= 24) {
            "flac24bit"
        } else {
            "flac"
        };
    }
    let bitrate = integer(&row["bitrate"]).or_else(|| integer(&row["br"]));
    // The current web API may ignore br. Its MP3 profile is 128K unless
    // the response explicitly confirms 320K; requested quality is not evidence.
    if bitrate.is_some_and(|rate| (300..=512).contains(&rate) || rate >= 300_000) {
        "320k"
    } else {
        "128k"
    }
}

pub(super) async fn resolve(
    client: &Client,
    session: &Session,
    id: &str,
    quality: &str,
    rejected: &[String],
) -> CommandResult<Option<(String, String)>> {
    numeric_id(id)?;
    // Personal playlists are also accessible by public uid: independently verify the session for playback.
    kuwo::account(client, &session.cookie).await?;
    for quality in quality_ladder(quality)? {
        let br = match *quality {
            "flac24bit" => "4000kflac",
            "flac" => "2000kflac",
            "320k" => "320kmp3",
            _ => "128kmp3",
        };
        let mut request = client
            .get("https://www.kuwo.cn/api/v1/www/music/playUrl")
            .header("Cookie", &session.cookie)
            .header("Referer", "https://www.kuwo.cn/")
            .header("User-Agent", "Mozilla/5.0")
            .header("Secret", secret(&session.cookie)?)
            .query(&[
                ("mid", id),
                ("type", "music"),
                ("httpsStatus", "1"),
                ("plat", "web_www"),
                ("from", ""),
                ("br", br),
                ("reqId", &kuwo::request_id()?),
            ]);
        if let Some(token) = cookies::value(&session.cookie, "kw_token") {
            request = request.header("csrf", token);
        }
        let response = request
            .send()
            .await
            .map_err(|_| CommandError::network("酷我账号解析失败，请稍后重试"))?;
        let data = http::read_response(response).await?;
        if matches!(data["code"].as_i64(), Some(301 | 401 | 403)) {
            return Err(auth_required());
        }
        let row = &data["data"];
        if trial(row) {
            continue;
        }
        if data["code"].as_i64() == Some(200) {
            if let Some(raw) = row["url"].as_str().filter(|url| !url.is_empty()) {
                let url = playback_url(Platform::Kuwo, raw)?;
                if rejected.contains(&url) {
                    continue;
                }
                let actual = actual_quality(row, &url);
                return Ok(Some((url, actual.to_string())));
            }
        } else if !matches!(data["code"].as_i64(), Some(-1 | -1001)) {
            return Err(invalid_response());
        }
    }
    Ok(None)
}

#[cfg(test)]
#[path = "../__tests__/kuwo_secret.rs"]
mod tests;
