//! Platform search HTTP requests for the discovery stage.

use reqwest::Client;
use serde_json::{json, Value};

use super::parse;
use crate::recommendation::model::RecSong;

pub(super) async fn search_source(
    client: &Client,
    source: &str,
    keyword: &str,
    limit: usize,
) -> Vec<RecSong> {
    match source {
        "netease" => search_netease(client, keyword, limit).await,
        "qq" => search_qq(client, keyword, limit).await,
        "kuwo" => search_kuwo(client, keyword, limit).await,
        _ => Vec::new(),
    }
}

async fn search_netease(client: &Client, keyword: &str, limit: usize) -> Vec<RecSong> {
    let params = [
        ("s", keyword.to_string()),
        ("type", "1".to_string()),
        ("offset", "0".to_string()),
        ("limit", limit.to_string()),
    ];
    let response = match client
        .get("https://music.163.com/api/cloudsearch/pc")
        .query(&params)
        .header("User-Agent", desktop_user_agent())
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            log::warn!("网易云发现搜索请求失败: {}", error);
            return Vec::new();
        }
    };
    let value: Value = match response.json().await {
        Ok(value) => value,
        Err(error) => {
            log::warn!("网易云发现搜索响应不是 JSON: {}", error);
            return Vec::new();
        }
    };
    parse::parse_netease_songs(&value)
}

async fn search_qq(client: &Client, keyword: &str, limit: usize) -> Vec<RecSong> {
    let body = json!({
        "comm": {
            "ct": 11,
            "cv": 1003006,
            "v": 1003006,
            "os_ver": "12",
            "phonetype": 0,
            "buildnum": 166,
            "tmeLoginType": 2
        },
        "req": {
            "method": "DoSearchForQQMusicDesktop",
            "module": "music.search.SearchCgiService",
            "param": {
                "query": keyword,
                "page_num": 1,
                "num_per_page": limit
            }
        }
    });
    let response = match client
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header("User-Agent", desktop_user_agent())
        .header("Origin", "https://y.qq.com")
        .header("Referer", "https://y.qq.com/portal/search.html")
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            log::warn!("QQ 音乐发现搜索请求失败: {}", error);
            return Vec::new();
        }
    };
    let value: Value = match response.json().await {
        Ok(value) => value,
        Err(error) => {
            log::warn!("QQ 音乐发现搜索响应不是 JSON: {}", error);
            return Vec::new();
        }
    };
    parse::parse_qq_songs(&value)
}

// Both kuwo endpoints are reachable over HTTPS (verified against the live
// services), so the LLM-derived search keywords, which reflect the user's
// taste profile, are no longer sent in cleartext.
async fn search_kuwo(client: &Client, keyword: &str, limit: usize) -> Vec<RecSong> {
    let params = [
        ("all", keyword.to_string()),
        ("ft", "music".to_string()),
        ("itemset", "web_2013".to_string()),
        ("pn", "0".to_string()),
        ("rn", limit.to_string()),
        ("encoding", "utf8".to_string()),
        ("rformat", "json".to_string()),
        ("moession", "1".to_string()),
        ("vkey", "VKEY".to_string()),
    ];
    let response = match client
        .get("https://search.kuwo.cn/r.s")
        .query(&params)
        .header("User-Agent", desktop_user_agent())
        .header("Referer", "https://kuwo.cn/")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            log::warn!("酷我发现搜索请求失败: {}", error);
            return Vec::new();
        }
    };
    let text = match response.text().await {
        Ok(text) => text,
        Err(error) => {
            log::warn!("酷我发现搜索响应读取失败: {}", error);
            return Vec::new();
        }
    };
    let Some(value) = parse::parse_kuwo_search_json(&text) else {
        return Vec::new();
    };
    let mut songs = parse::parse_kuwo_songs(&value);
    fill_kuwo_covers(client, &mut songs).await;
    songs
}

/// Fetches missing covers concurrently; a failed lookup leaves `pic` unset.
async fn fill_kuwo_covers(client: &Client, songs: &mut [RecSong]) {
    let handles: Vec<_> = songs
        .iter()
        .enumerate()
        .filter(|(_, song)| song.pic.is_none())
        .map(|(index, song)| {
            let client = client.clone();
            let song_id = parse::value_id(&song.id);
            (
                index,
                tokio::spawn(async move { fetch_kuwo_cover(&client, song_id).await }),
            )
        })
        .collect();
    for (index, handle) in handles {
        if let Ok(pic) = handle.await {
            songs[index].pic = pic;
        }
    }
}

async fn fetch_kuwo_cover(client: &Client, song_id: String) -> Option<String> {
    if song_id.trim().is_empty() {
        return None;
    }
    let params = [
        ("corp", "kuwo".to_string()),
        ("type", "rid_pic".to_string()),
        ("pictype", "500".to_string()),
        ("size", "500".to_string()),
        ("rid", song_id),
    ];
    let response = client
        .get("https://artistpicserver.kuwo.cn/pic.web")
        .query(&params)
        .header("User-Agent", desktop_user_agent())
        .header("Referer", "https://kuwo.cn/")
        .send()
        .await
        .ok()?;
    let text = response.text().await.ok()?.trim().to_string();
    if text.starts_with("http") {
        Some(text)
    } else {
        None
    }
}

fn desktop_user_agent() -> &'static str {
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
}
