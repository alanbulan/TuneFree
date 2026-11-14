use reqwest::Client;
use serde_json::{json, Value};

use super::{http, model::*, netease, qq};
use crate::app::error::CommandResult;

pub(super) async fn netease(
    client: &Client,
    session: &Session,
    id: &str,
    page: usize,
) -> CommandResult<PlatformPlaylistPreview> {
    numeric_id(id)?;
    let offset = preview_offset(page)?;
    // Fetch the ordered IDs with at most one preview page of initial song metadata.
    let data = http::netease_get(
        client,
        &session.cookie,
        "/api/v6/playlist/detail",
        &[("id", id.into()), ("n", PREVIEW_PAGE_SIZE.to_string())],
    )
    .await?;
    let list = &data["playlist"];
    let name = list["name"]
        .as_str()
        .ok_or_else(invalid_response)?
        .to_string();
    let ids = list["trackIds"].as_array().ok_or_else(invalid_response)?;
    if ids.len() > 10_000 || integer(&list["trackCount"]) != Some(ids.len()) {
        return Err(invalid_response());
    }
    let visible = ids
        .iter()
        .skip(offset)
        .take(PREVIEW_PAGE_SIZE)
        .map(|row| value_string(&row["id"]).ok_or_else(invalid_response))
        .collect::<CommandResult<Vec<_>>>()?;
    for id in &visible {
        numeric_id(id)?;
    }
    let songs = if visible.is_empty() {
        Vec::new()
    } else {
        let encoded = serde_json::to_string(
            &visible
                .iter()
                .map(|id| json!({"id":id.parse::<u64>().unwrap_or(0)}))
                .collect::<Vec<_>>(),
        )?;
        let details = http::netease_get(
            client,
            &session.cookie,
            "/api/v3/song/detail",
            &[("c", encoded)],
        )
        .await?;
        let rows = details["songs"].as_array().ok_or_else(invalid_response)?;
        netease::order_songs(
            &visible,
            rows.iter()
                .map(netease::parse_song)
                .collect::<CommandResult<Vec<_>>>()?,
        )?
    };
    Ok(PlatformPlaylistPreview {
        name,
        songs,
        total: ids.len(),
        page,
        page_size: PREVIEW_PAGE_SIZE,
    })
}

pub(super) async fn qq(
    client: &Client,
    session: &Session,
    id: &str,
    page: usize,
) -> CommandResult<PlatformPlaylistPreview> {
    let offset = preview_offset(page)?;
    let liked = id == "liked";
    let tid = if liked {
        0
    } else {
        numeric_id(id)?
            .parse::<u64>()
            .map_err(|_| invalid_response())?
    };
    let mut param = json!({"disstid":tid,"dirid":if liked {201} else {0},"tag":true,
        "song_begin":offset,"song_num":PREVIEW_PAGE_SIZE,"userinfo":true,"orderlist":true});
    if liked {
        let euin = match &session.encrypted_user_id {
            Some(id) => id.clone(),
            None => qq::encrypted_user_id(client, session).await?,
        };
        param["enc_host_uin"] = Value::String(euin);
    }
    let data = http::qq_request(
        client,
        &session.cookie,
        "music.srfDissInfo.DissInfo",
        "CgiGetDiss",
        param,
    )
    .await?;
    let (songs, total, more) = qq::parse_song_page(&data)?;
    if total > 10_000
        || songs.len() != total.saturating_sub(offset).min(PREVIEW_PAGE_SIZE)
        || more != (offset + songs.len() < total)
    {
        return Err(invalid_response());
    }
    Ok(PlatformPlaylistPreview {
        name: data["dirinfo"]["title"]
            .as_str()
            .ok_or_else(invalid_response)?
            .into(),
        songs,
        total,
        page,
        page_size: PREVIEW_PAGE_SIZE,
    })
}
