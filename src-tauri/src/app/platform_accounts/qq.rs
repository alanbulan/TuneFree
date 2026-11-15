use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::Client;
use serde_json::{json, Value};
use std::collections::HashSet;

use super::{cookies, http, model::*};
use crate::app::error::{CommandError, CommandResult};

const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 100;

pub(super) async fn account(client: &Client, cookie: &str) -> CommandResult<Session> {
    let data = http::qq_request(
        client,
        cookie,
        "music.UserInfo.userInfoServer",
        "GetLoginUserInfo",
        json!({}),
    )
    .await?;
    let mut session = parse_account(data, cookie)?;
    if session.account.avatar_url.is_none() {
        // The login check does not reliably include a portrait. The website
        // queries BaseUserInfoServer separately; see the fixed protocol references.
        session.account.avatar_url = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            account_avatar(client, &session),
        )
        .await
        .ok()
        .flatten();
    }
    Ok(session)
}

async fn account_avatar(client: &Client, session: &Session) -> Option<String> {
    let data = http::qq_request(
        client,
        &session.cookie,
        "userInfo.BaseUserInfoServer",
        "get_user_baseinfo_v2",
        json!({"vec_uin": [session.account.user_id]}),
    )
    .await;
    if let Ok(data) = data {
        let profile = &data["map_userinfo"][&session.account.user_id];
        let matches_user =
            value_string(&profile["uin"]).as_deref() == Some(session.account.user_id.as_str());
        if data["code"].as_i64() == Some(0) && matches_user {
            if let Some(avatar) = image_url(&profile["headurl"]) {
                return Some(avatar);
            }
        }
    }
    let encrypted_id = session.encrypted_user_id.as_deref()?;
    let data = http::qq_request(
        client,
        &session.cookie,
        "music.UnifiedHomepage.UnifiedHomepageSrv",
        "GetHomepageHeader",
        json!({"uin": encrypted_id, "IsQueryTabDetail": 1}),
    )
    .await
    .ok()?;
    let profile = &data["Info"]["BaseInfo"];
    if value_string(&profile["EncryptedUin"]).as_deref() != Some(encrypted_id) {
        return None;
    }
    image_url(&profile["Avatar"])
}

pub(super) fn parse_account(data: Value, cookie: &str) -> CommandResult<Session> {
    let info = &data["info"];
    let user_id = cookies::qq_user_id(cookie).ok_or_else(auth_required)?;
    let nickname = info["nick"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(invalid_response)?;
    let encrypted_user_id = value_string(&info["encryptUin"])
        .or_else(|| value_string(&info["encrypt_uin"]))
        .or_else(|| value_string(&info["euin"]));
    Ok(Session {
        account: PlatformAccount {
            platform: "qq".into(),
            user_id,
            nickname: nickname.into(),
            avatar_url: image_url(&info["headurl"]).or_else(|| image_url(&info["head"])),
            state: "connected".into(),
            connected_at: now_ms(),
        },
        cookie: cookie.into(),
        encrypted_user_id,
    })
}

fn playlist(row: &Value, kind: &str) -> CommandResult<PlatformPlaylist> {
    let dirid = value_string(&row["dirid"])
        .or_else(|| value_string(&row["dirId"]))
        .unwrap_or_default();
    let tid = ["tid", "id", "dissid", "diss_id"]
        .into_iter()
        .find_map(|field| value_string(&row[field]))
        .unwrap_or_else(|| "0".into());
    numeric_id(&tid)?;
    let id = if dirid == "201" {
        "liked".to_string()
    } else {
        tid
    };
    if id == "0" {
        return Err(invalid_response());
    }
    let name = ["title", "dissname", "name", "dirName"]
        .into_iter()
        .find_map(|field| row[field].as_str())
        .ok_or_else(invalid_response)?;
    let count = ["songnum", "songNum", "song_cnt"]
        .into_iter()
        .find_map(|field| row[field].as_u64())
        .ok_or_else(invalid_response)?;
    let cover_url = ["picurl", "picUrl", "cover", "logo"]
        .into_iter()
        .find_map(|field| image_url(&row[field]));
    Ok(PlatformPlaylist {
        id,
        name: name.into(),
        cover_url,
        track_count: count as usize,
        kind: kind.into(),
    })
}

pub(super) fn parse_playlists(
    data: &Value,
    kind: &str,
) -> CommandResult<(Vec<PlatformPlaylist>, bool)> {
    let key = if kind == "created" {
        "v_playlist"
    } else {
        "v_list"
    };
    let rows = data[key].as_array().ok_or_else(invalid_response)?;
    let playlists = rows
        .iter()
        .map(|row| playlist(row, kind))
        .collect::<CommandResult<Vec<_>>>()?;
    let more = if kind == "created" {
        !flag(&data["bFinish"]).ok_or_else(invalid_response)?
    } else {
        flag(&data["hasmore"]).ok_or_else(invalid_response)?
    };
    Ok((playlists, more))
}

fn flag(value: &Value) -> Option<bool> {
    value
        .as_bool()
        .or_else(|| value.as_i64().map(|value| value != 0))
}

pub(super) async fn playlists(
    client: &Client,
    session: &Session,
) -> CommandResult<Vec<PlatformPlaylist>> {
    let data = http::qq_request(
        client,
        &session.cookie,
        "music.musicasset.PlaylistBaseRead",
        "GetPlaylistByUin",
        json!({ "uin": session.account.user_id }),
    )
    .await?;
    let (mut result, more) = parse_playlists(&data, "created")?;
    // This method has no documented cursor; do not label an unfinished response as complete.
    if more {
        return Err(CommandError::network("QQ 音乐尚未返回全部创建歌单，请重试"));
    }
    let euin = match &session.encrypted_user_id {
        Some(id) => id.clone(),
        None => encrypted_user_id(client, session).await?,
    };
    let mut seen: HashSet<String> = result.iter().map(|playlist| playlist.id.clone()).collect();
    for page in 0..MAX_PAGES {
        let data = http::qq_request(
            client,
            &session.cookie,
            "music.musicasset.PlaylistFavRead",
            "CgiGetPlaylistFavInfo",
            json!({
                "uin": euin, "offset": page * PAGE_SIZE, "size": PAGE_SIZE,
            }),
        )
        .await?;
        let (rows, more) = parse_playlists(&data, "collected")?;
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
    Err(invalid_response())
}

pub(super) async fn encrypted_user_id(client: &Client, session: &Session) -> CommandResult<String> {
    // Older website sessions omit encryptUin in GetLoginUserInfo.
    // CgiGetDiss accepts the legacy ID encoding and returns the current
    // login's canonical encrypt_login, which PlaylistFavRead requires.
    let mut legacy = vec![0_u8; 3];
    legacy.extend_from_slice(session.account.user_id.as_bytes());
    let data = http::qq_request(
        client,
        &session.cookie,
        "music.srfDissInfo.DissInfo",
        "CgiGetDiss",
        json!({"disstid":0,"dirid":201,"song_begin":0,"song_num":1,
            "userinfo":true,"orderlist":true,"enc_host_uin":STANDARD.encode(legacy)}),
    )
    .await?;
    value_string(&data["encrypt_login"])
        .or_else(|| value_string(&data["dirinfo"]["encrypt_uin"]))
        .filter(|id| id.len() <= 256)
        .ok_or_else(|| CommandError::network("QQ 音乐未返回账号标识，无法读取收藏歌单，请重新登录"))
}

pub(super) fn parse_song(song: &Value) -> CommandResult<PlatformPlaylistSong> {
    let song = if song["songInfo"].is_object() {
        &song["songInfo"]
    } else {
        song
    };
    let id = value_string(&song["mid"])
        .or_else(|| value_string(&song["songmid"]))
        .ok_or_else(invalid_response)?;
    if id.len() > 128 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err(invalid_response());
    }
    let name = song["name"]
        .as_str()
        .or_else(|| song["songname"].as_str())
        .ok_or_else(invalid_response)?
        .to_string();
    let artist = song["singer"]
        .as_array()
        .ok_or_else(invalid_response)?
        .iter()
        .filter_map(|item| item["name"].as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let album = song["album"]["name"]
        .as_str()
        .or_else(|| song["albumname"].as_str())
        .unwrap_or_default()
        .to_string();
    let album_mid = song["album"]["mid"]
        .as_str()
        .or_else(|| song["albummid"].as_str());
    let pic = album_mid
        .filter(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_alphanumeric()))
        .map(|id| format!("https://y.gtimg.cn/music/photo_new/T002R500x500M000{id}.jpg"));
    Ok(PlatformPlaylistSong {
        id,
        source: "qq".into(),
        name,
        artist,
        album,
        pic,
        lyric_id: value_string(&song["id"]).or_else(|| value_string(&song["songid"])),
        str_media_mid: value_string(&song["file"]["media_mid"])
            .or_else(|| value_string(&song["strMediaMid"])),
    })
}

pub(super) fn parse_song_page(
    data: &Value,
) -> CommandResult<(Vec<PlatformPlaylistSong>, usize, bool)> {
    let rows = data["songlist"].as_array().ok_or_else(invalid_response)?;
    let songs = rows
        .iter()
        .map(parse_song)
        .collect::<CommandResult<Vec<_>>>()?;
    let total = data["total_song_num"]
        .as_u64()
        .ok_or_else(invalid_response)? as usize;
    let more = flag(&data["hasmore"]).ok_or_else(invalid_response)?;
    Ok((songs, total, more))
}

pub(super) async fn import(
    client: &Client,
    session: &Session,
    id: &str,
) -> CommandResult<PlatformPlaylistImport> {
    let liked = id == "liked";
    let tid = if liked {
        0
    } else {
        numeric_id(id)?
            .parse::<u64>()
            .map_err(|_| CommandError::invalid_argument("歌单 ID 不正确"))?
    };
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    let mut name = String::new();
    let mut expected_total = None;
    let euin = if liked {
        Some(match &session.encrypted_user_id {
            Some(id) => id.clone(),
            None => encrypted_user_id(client, session).await?,
        })
    } else {
        None
    };
    for page in 0..MAX_PAGES {
        let mut param = json!({ "disstid": tid, "dirid": if liked { 201 } else { 0 }, "tag": true,
            "song_begin": page * PAGE_SIZE, "song_num": PAGE_SIZE, "userinfo": true, "orderlist": true });
        if let Some(id) = &euin {
            param["enc_host_uin"] = json!(id);
        }
        let data = http::qq_request(
            client,
            &session.cookie,
            "music.srfDissInfo.DissInfo",
            "CgiGetDiss",
            param,
        )
        .await?;
        if page == 0 {
            name = data["dirinfo"]["title"]
                .as_str()
                .ok_or_else(invalid_response)?
                .to_string();
        }
        let (songs, total, more) = parse_song_page(&data)?;
        if total > 10_000 || expected_total.is_some_and(|expected| expected != total) {
            return Err(invalid_response());
        }
        expected_total = Some(total);
        let before = result.len();
        result.extend(
            songs
                .into_iter()
                .filter(|song| seen.insert(song.id.clone())),
        );
        if result.len() > total {
            return Err(invalid_response());
        }
        if result.len() == total && !more {
            return Ok(PlatformPlaylistImport {
                name,
                songs: result,
            });
        }
        if !more || result.len() == before {
            return Err(CommandError::network(
                "部分 QQ 音乐歌曲读取失败，尚未导入，请重试",
            ));
        }
    }
    Err(invalid_response())
}

#[cfg(test)]
#[path = "__tests__/qq.rs"]
mod tests;
