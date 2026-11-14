use reqwest::Client;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use super::{http, model::*};
use crate::app::error::{CommandError, CommandResult};

const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 100;

pub(super) async fn account(client: &Client, cookie: &str) -> CommandResult<Session> {
    let body = {
        let mut form = url::form_urlencoded::Serializer::new(String::new());
        form.append_pair(
            "csrf_token",
            super::cookies::value(cookie, "__csrf").unwrap_or_default(),
        );
        form.finish()
    };
    let response = client
        .post("https://music.163.com/api/nuser/account/get")
        .header("Cookie", cookie)
        .header("Referer", "https://music.163.com/")
        .header("User-Agent", "Mozilla/5.0")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|_| CommandError::network("网易云连接检查失败，请稍后重试"))?;
    parse_account(http::read_response(response).await?, cookie)
}

pub(super) fn parse_account(data: Value, cookie: &str) -> CommandResult<Session> {
    http::check_netease(&data)?;
    let profile = &data["profile"];
    let user_id = value_string(&profile["userId"]).ok_or_else(auth_required)?;
    numeric_id(&user_id)?;
    let nickname = profile["nickname"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(invalid_response)?;
    Ok(Session {
        account: PlatformAccount {
            platform: "netease".into(),
            user_id,
            nickname: nickname.into(),
            avatar_url: image_url(&profile["avatarUrl"]),
            state: "connected".into(),
            connected_at: now_ms(),
        },
        cookie: cookie.into(),
        encrypted_user_id: None,
    })
}

pub(super) fn parse_playlists(
    data: &Value,
    user_id: &str,
) -> CommandResult<(Vec<PlatformPlaylist>, bool)> {
    http::check_netease(data)?;
    let rows = data["playlist"].as_array().ok_or_else(invalid_response)?;
    let playlists = rows
        .iter()
        .map(|row| {
            let id = value_string(&row["id"]).ok_or_else(invalid_response)?;
            numeric_id(&id)?;
            let name = row["name"]
                .as_str()
                .ok_or_else(invalid_response)?
                .to_string();
            let creator = value_string(&row["creator"]["userId"]);
            Ok(PlatformPlaylist {
                id,
                name,
                cover_url: image_url(&row["coverImgUrl"]),
                track_count: row["trackCount"].as_u64().ok_or_else(invalid_response)? as usize,
                kind: if creator.as_deref() == Some(user_id) {
                    "created"
                } else {
                    "collected"
                }
                .into(),
            })
        })
        .collect::<CommandResult<Vec<_>>>()?;
    Ok((
        playlists,
        data["more"].as_bool().ok_or_else(invalid_response)?,
    ))
}

pub(super) async fn playlists(
    client: &Client,
    session: &Session,
) -> CommandResult<Vec<PlatformPlaylist>> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for page in 0..MAX_PAGES {
        let data = http::netease_get(
            client,
            &session.cookie,
            "/api/user/playlist",
            &[
                ("uid", session.account.user_id.clone()),
                ("limit", PAGE_SIZE.to_string()),
                ("offset", (page * PAGE_SIZE).to_string()),
            ],
        )
        .await?;
        let (rows, more) = parse_playlists(&data, &session.account.user_id)?;
        let before = result.len();
        result.extend(
            rows.into_iter()
                .filter(|playlist| seen.insert(playlist.id.clone())),
        );
        if !more {
            return Ok(result);
        }
        if result.len() == before {
            return Err(invalid_response());
        }
    }
    Err(CommandError::network(
        "歌单数量超过本次读取范围，请稍后重试",
    ))
}

pub(super) fn parse_song(song: &Value) -> CommandResult<PlatformPlaylistSong> {
    let id = value_string(&song["id"]).ok_or_else(invalid_response)?;
    numeric_id(&id)?;
    let artist = song["ar"]
        .as_array()
        .or_else(|| song["artists"].as_array())
        .ok_or_else(invalid_response)?
        .iter()
        .filter_map(|item| item["name"].as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let album = if song["al"].is_object() {
        &song["al"]
    } else {
        &song["album"]
    };
    Ok(PlatformPlaylistSong {
        id,
        source: "netease".into(),
        name: song["name"].as_str().ok_or_else(invalid_response)?.into(),
        artist,
        album: album["name"].as_str().unwrap_or_default().into(),
        pic: image_url(&album["picUrl"]),
        lyric_id: None,
        str_media_mid: None,
    })
}

pub(super) fn order_songs(
    ids: &[String],
    songs: Vec<PlatformPlaylistSong>,
) -> CommandResult<Vec<PlatformPlaylistSong>> {
    let by_id: HashMap<_, _> = songs
        .into_iter()
        .map(|song| (song.id.clone(), song))
        .collect();
    ids.iter()
        .map(|id| {
            by_id
                .get(id)
                .cloned()
                .ok_or_else(|| CommandError::network("部分歌曲读取失败，尚未导入，请重试"))
        })
        .collect()
}

pub(super) async fn import(
    client: &Client,
    session: &Session,
    id: &str,
) -> CommandResult<PlatformPlaylistImport> {
    numeric_id(id)?;
    let data = http::netease_get(
        client,
        &session.cookie,
        "/api/v6/playlist/detail",
        &[("id", id.into()), ("n", "1000".into())],
    )
    .await?;
    let playlist = &data["playlist"];
    let name = playlist["name"]
        .as_str()
        .ok_or_else(invalid_response)?
        .to_string();
    let ids = playlist["trackIds"]
        .as_array()
        .ok_or_else(invalid_response)?
        .iter()
        .map(|item| value_string(&item["id"]).ok_or_else(invalid_response))
        .collect::<CommandResult<Vec<_>>>()?;
    if ids.len() > 10_000 || playlist["trackCount"].as_u64() != Some(ids.len() as u64) {
        return Err(invalid_response());
    }
    for id in &ids {
        numeric_id(id)?;
    }
    let tracks = playlist["tracks"].as_array().ok_or_else(invalid_response)?;
    let mut songs = tracks
        .iter()
        .map(parse_song)
        .collect::<CommandResult<Vec<_>>>()?;
    let existing: HashSet<_> = songs.iter().map(|song| song.id.clone()).collect();
    let missing = ids
        .iter()
        .filter(|id| !existing.contains(*id))
        .collect::<Vec<_>>();
    for batch in missing.chunks(PAGE_SIZE) {
        let encoded = serde_json::to_string(
            &batch
                .iter()
                .map(|id| json!({ "id": id.parse::<u64>().unwrap_or(0) }))
                .collect::<Vec<_>>(),
        )?;
        let data = http::netease_get(
            client,
            &session.cookie,
            "/api/v3/song/detail",
            &[("c", encoded)],
        )
        .await?;
        let tracks = data["songs"].as_array().ok_or_else(invalid_response)?;
        songs.extend(
            tracks
                .iter()
                .map(parse_song)
                .collect::<CommandResult<Vec<_>>>()?,
        );
    }
    Ok(PlatformPlaylistImport {
        name,
        songs: order_songs(&ids, songs)?,
    })
}

#[cfg(test)]
#[path = "__tests__/netease.rs"]
mod tests;
