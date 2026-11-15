//! Official web session and account library protocols. See docs/platform-account-references.md.
use reqwest::Client;
use serde_json::Value;
use std::collections::HashSet;

use super::{cookies, http, model::*};
use crate::app::error::{CommandError, CommandResult};

pub(super) fn request_id() -> CommandResult<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| CommandError::internal("无法建立平台请求"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub(super) async fn account(client: &Client, cookie: &str) -> CommandResult<Session> {
    let uid = cookies::kuwo_user_id(cookie).ok_or_else(auth_required)?;
    let sid = cookies::kuwo_session_id(cookie).ok_or_else(auth_required)?;
    let form = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("uid", uid)
        .append_pair("sid", sid)
        .finish();
    let response = client
        .post("https://www.kuwo.cn/api/user/checkLogin")
        .header("Cookie", cookie)
        .header("Origin", "https://www.kuwo.cn")
        .header("Referer", "https://www.kuwo.cn/")
        .header("User-Agent", "Mozilla/5.0")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form)
        .send()
        .await
        .map_err(|_| CommandError::network("酷我连接检查失败，请稍后重试"))?;
    let data = http::read_response(response).await?;
    if data["status"].as_i64() != Some(200) {
        return Err(auth_required());
    }
    parse_account(cookie)
}

fn parse_account(cookie: &str) -> CommandResult<Session> {
    let uid = cookies::kuwo_user_id(cookie).ok_or_else(auth_required)?;
    let name = ["uname3", "username", "nickName"]
        .into_iter()
        .filter_map(|key| cookies::value(cookie, key).map(decode_cookie))
        .find(|name| !name.trim().is_empty())
        .unwrap_or_default();
    // pic3 is the website's portrait cookie. Validate each decoded candidate
    // before falling back to pic; a placeholder pic3 must not mask a valid pic.
    let avatar = ["pic3", "pic"].into_iter().find_map(|key| {
        let raw = cookies::value(cookie, key)?;
        image_url(&Value::String(decode_cookie(raw)))
    });
    Ok(Session {
        account: PlatformAccount {
            platform: "kuwo".into(),
            user_id: uid.into(),
            nickname: if name.is_empty() {
                "酷我音乐用户".into()
            } else {
                name
            },
            avatar_url: avatar,
            state: "connected".into(),
            connected_at: now_ms(),
        },
        cookie: cookie.into(),
        encrypted_user_id: None,
    })
}

/** Official cookies use escape() UTF-16 codes and occasionally multiple URI encodings. */
fn decode_cookie(raw: &str) -> String {
    let mut text = raw.to_string();
    for _ in 0..3 {
        let bytes = text.as_bytes();
        let mut units = Vec::new();
        let mut offset = 0;
        while offset < bytes.len() {
            if bytes[offset..].starts_with(b"%u") && offset + 6 <= bytes.len() {
                if let Ok(hex) = std::str::from_utf8(&bytes[offset + 2..offset + 6]) {
                    if let Ok(unit) = u16::from_str_radix(hex, 16) {
                        units.push(unit);
                        offset += 6;
                        continue;
                    }
                }
            }
            let character = text[offset..].chars().next().unwrap_or_default();
            units.extend(character.encode_utf16(&mut [0; 2]).iter().copied());
            offset += character.len_utf8();
        }
        let unicode = String::from_utf16_lossy(&units);
        let decoded = percent_decode(&unicode);
        if decoded == text {
            break;
        }
        text = decoded;
    }
    text
}

fn percent_decode(raw: &str) -> String {
    let mut bytes = Vec::new();
    let input = raw.as_bytes();
    let mut offset = 0;
    while offset < input.len() {
        if input[offset] == b'%' && offset + 3 <= input.len() {
            if let Ok(hex) = std::str::from_utf8(&input[offset + 1..offset + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    bytes.push(byte);
                    offset += 3;
                    continue;
                }
            }
        }
        bytes.push(input[offset]);
        offset += 1;
    }
    String::from_utf8(bytes).unwrap_or_else(|_| raw.into())
}

async fn request(client: &Client, cookie: &str, query: &[(&str, String)]) -> CommandResult<Value> {
    let response = client
        .get("https://nplserver.kuwo.cn/pl.svc")
        .header("Cookie", cookie)
        .header("Referer", "https://www.kuwo.cn/")
        .header("User-Agent", "Mozilla/5.0")
        .query(query)
        .send()
        .await
        .map_err(|_| CommandError::network("酷我歌单读取失败，请稍后重试"))?;
    let data = http::read_response(response).await?;
    if data["result"].as_str() != Some("ok") {
        return Err(invalid_response());
    }
    Ok(data)
}

pub(super) async fn playlists(
    client: &Client,
    session: &Session,
) -> CommandResult<Vec<PlatformPlaylist>> {
    // This endpoint ignores pn/rn and returns the complete library; bound its body and row count.
    let data = request(
        client,
        &session.cookie,
        &[
            ("op", "getlistbyuid".into()),
            ("bigid", "1".into()),
            ("uid", session.account.user_id.clone()),
            ("encode", "utf8".into()),
        ],
    )
    .await?;
    let rows = data["plist"].as_array().ok_or_else(invalid_response)?;
    if rows.len() > 10_000 {
        return Err(invalid_response());
    }
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for row in rows {
        let id = value_string(&row["id"]).ok_or_else(invalid_response)?;
        numeric_id(&id)?;
        if !seen.insert(id.clone()) {
            continue;
        }
        result.push(PlatformPlaylist {
            id,
            name: row["title"].as_str().ok_or_else(invalid_response)?.into(),
            cover_url: image_url(&row["pic"]),
            track_count: integer(&row["musicnum"]).ok_or_else(invalid_response)?,
            kind: if value_string(&row["uid"]).as_deref() == Some(session.account.user_id.as_str())
                || matches!(row["type"].as_str(), Some("GENERAL" | "MYFAVORITE"))
            {
                "created"
            } else {
                "collected"
            }
            .into(),
        });
    }
    Ok(result)
}

pub(super) async fn preview(
    client: &Client,
    session: &Session,
    id: &str,
    page: usize,
) -> CommandResult<PlatformPlaylistPreview> {
    numeric_id(id)?;
    let offset = preview_offset(page)?;
    let data = request(
        client,
        &session.cookie,
        &[
            ("op", "getlistinfo".into()),
            ("pid", id.into()),
            ("pn", (page - 1).to_string()),
            ("rn", PREVIEW_PAGE_SIZE.to_string()),
            ("encode", "utf8".into()),
            ("keyset", "pl2012".into()),
            ("identity", "kuwo".into()),
            ("pcmp4", "1".into()),
            ("vipver", "MUSIC_9.0.5.0_W1".into()),
            ("newver", "1".into()),
        ],
    )
    .await?;
    let total = integer(&data["total"])
        .filter(|total| *total <= 10_000)
        .ok_or_else(invalid_response)?;
    let rows = data["musiclist"].as_array().ok_or_else(invalid_response)?;
    // validtotal is zero on real responses which do contain songs; it cannot be used as a count.
    if rows.len() != total.saturating_sub(offset).min(PREVIEW_PAGE_SIZE) {
        return Err(invalid_response());
    }
    let songs = rows
        .iter()
        .map(|row| {
            let id = value_string(&row["id"]).ok_or_else(invalid_response)?;
            let id = id.strip_prefix("MUSIC_").unwrap_or(&id);
            numeric_id(id)?;
            Ok(PlatformPlaylistSong {
                id: id.into(),
                source: "kuwo".into(),
                name: row["name"].as_str().ok_or_else(invalid_response)?.into(),
                artist: row["artist"]
                    .as_str()
                    .unwrap_or_default()
                    .replace('&', ", "),
                album: row["album"].as_str().unwrap_or_default().into(),
                pic: image_url(&row["pic"]),
                lyric_id: None,
                str_media_mid: None,
            })
        })
        .collect::<CommandResult<Vec<_>>>()?;
    Ok(PlatformPlaylistPreview {
        name: data["title"].as_str().ok_or_else(invalid_response)?.into(),
        songs,
        total,
        page,
        page_size: PREVIEW_PAGE_SIZE,
    })
}

pub(super) async fn import(
    client: &Client,
    session: &Session,
    id: &str,
) -> CommandResult<PlatformPlaylistImport> {
    let first = preview(client, session, id, 1).await?;
    let total = first.total;
    let mut songs = first.songs;
    let mut seen: HashSet<_> = songs.iter().map(|song| song.id.clone()).collect();
    for page in 2..=total.div_ceil(PREVIEW_PAGE_SIZE) {
        let next = preview(client, session, id, page).await?;
        if next.total != total || next.name != first.name {
            return Err(invalid_response());
        }
        for song in next.songs {
            if !seen.insert(song.id.clone()) {
                return Err(invalid_response());
            }
            songs.push(song);
        }
    }
    if songs.len() != total {
        return Err(invalid_response());
    }
    Ok(PlatformPlaylistImport {
        name: first.name,
        songs,
    })
}

#[cfg(test)]
#[path = "__tests__/kuwo.rs"]
mod tests;
