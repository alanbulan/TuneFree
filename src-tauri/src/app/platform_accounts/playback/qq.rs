//! Adapted from LingyunStudio/RustMusic url.rs (Apache-2.0); see docs/platform-account-references.md.
use super::{playback_url, quality_ladder};
use crate::app::{
    error::{CommandError, CommandResult},
    platform_accounts::{cookies, http, model::*},
};
use reqwest::Client;
use serde_json::{json, Value};

fn valid_mid(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn guid(session: &Session) -> String {
    // QQ expects ten decimal digits, stable for the saved login across restarts.
    // Derive a wire device identifier without storing additional credentials.
    let seed = format!(
        "TuneFree:qq:{}:{}",
        session.account.user_id, session.account.connected_at
    );
    let hash = md5::compute(seed);
    let value = u64::from_be_bytes(hash.0[..8].try_into().expect("eight digest bytes"));
    (1_000_000_000 + value % 9_000_000_000).to_string()
}

fn candidates(
    file: &Value,
    song_mid: &str,
    media_mid: &str,
    quality: &str,
) -> CommandResult<Vec<(String, String)>> {
    let known = ["size_hires", "size_flac", "size_320mp3", "size_128mp3"]
        .iter()
        .any(|key| integer(&file[key]).is_some());
    let mut result = Vec::new();
    for quality in quality_ladder(quality)? {
        let (prefix, ext, size) = match *quality {
            "flac24bit" => ("RS01", "flac", "size_hires"),
            "flac" => ("F000", "flac", "size_flac"),
            "320k" => ("M800", "mp3", "size_320mp3"),
            _ => ("M500", "mp3", "size_128mp3"),
        };
        if known && integer(&file[size]).unwrap_or(0) == 0 && *quality != "128k" {
            continue;
        }
        result.push((
            format!("{prefix}{media_mid}{song_mid}.{ext}"),
            quality.to_string(),
        ));
    }
    Ok(result)
}

pub(super) async fn resolve(
    client: &Client,
    session: &Session,
    id: &str,
    quality: &str,
    media_mid: Option<&str>,
    rejected: &[String],
) -> CommandResult<Option<(String, String)>> {
    if !valid_mid(id) || media_mid.is_some_and(|id| !valid_mid(id)) {
        return Err(CommandError::invalid_argument("QQ 歌曲标识不正确"));
    }
    let cookie = &session.cookie;
    let tracks = http::qq_signed(
        client,
        cookie,
        "music.trackInfo.UniformRuleCtrl",
        "CgiGetTrackInfo",
        json!({"types":[1],"ids":[0],"mids":[id]}),
        None,
    )
    .await?;
    let track = tracks["tracks"]
        .as_array()
        .and_then(|rows| rows.first())
        .ok_or_else(invalid_response)?;
    let file = &track["file"];
    let media = file["media_mid"]
        .as_str()
        .filter(|id| valid_mid(id))
        .or(media_mid)
        .unwrap_or(id);
    let rungs = candidates(file, id, media, quality)?;
    let mut comm = cookies::qq_request_comm(cookie);
    comm["ct"] = json!(19);
    comm["cv"] = json!(1859);
    comm["qqmusic_key"] = comm["authst"].clone();
    let data = http::qq_signed(client, cookie, "music.vkey.GetVkey", "UrlGetVkey", json!({
        "uin":session.account.user_id, "filename":rungs.iter().map(|(name,_)| name).collect::<Vec<_>>(),
        "guid":guid(session), "songmid":vec![id;rungs.len()],
        "songtype":vec![0;rungs.len()],"ctx":0,
    }), Some(comm)).await?;
    let infos = data["midurlinfo"].as_array().ok_or_else(invalid_response)?;
    if infos.len() != rungs.len() {
        return Err(invalid_response());
    }
    let base = data["sip"]
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .find(|url| url.starts_with("https://"))
        })
        .unwrap_or("https://ws.stream.qqmusic.qq.com/");
    let base = url::Url::parse(base).map_err(|_| invalid_response())?;
    for ((filename, quality), info) in rungs.iter().zip(infos) {
        if info["filename"]
            .as_str()
            .is_some_and(|name| name != filename)
        {
            return Err(invalid_response());
        }
        let Some(path) = info["purl"].as_str().filter(|path| !path.is_empty()) else {
            continue;
        };
        let joined = base.join(path).map_err(|_| invalid_response())?;
        let url = playback_url(Platform::Qq, joined.as_str())?;
        if rejected.contains(&url) {
            continue;
        }
        return Ok(Some((url, quality.clone())));
    }
    Ok(None)
}

#[cfg(test)]
#[path = "../__tests__/qq_quality.rs"]
mod tests;
