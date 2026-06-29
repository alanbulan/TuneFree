use reqwest::Client;
use serde_json::{json, Value};

use super::{catalog, llm::DiscoverySearchQuery, model::RecSong, privacy};

#[derive(Debug, Clone)]
pub struct DiscoveredSong {
    pub song: RecSong,
    pub reason: String,
}

pub async fn discover_songs(
    client: Client,
    queries: Vec<DiscoverySearchQuery>,
    per_source_limit: usize,
    max_total: usize,
) -> Vec<DiscoveredSong> {
    let mut songs = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for query in queries {
        let sources: &[&str] = match query.source.as_str() {
            "netease" => &["netease"],
            "qq" => &["qq"],
            "kuwo" => &["kuwo"],
            _ => &["netease", "qq", "kuwo"],
        };

        for source in sources {
            let found = search_source(&client, source, &query.keyword, per_source_limit).await;
            for song in found {
                let identity = format!(
                    "{}:{}",
                    catalog::normalize_text(&song.name),
                    catalog::normalize_text(&song.artist)
                );
                if identity.trim_matches(':').is_empty() || !seen.insert(identity) {
                    continue;
                }
                songs.push(DiscoveredSong {
                    song,
                    reason: query.reason.clone(),
                });
                if songs.len() >= max_total {
                    return songs;
                }
            }
        }
    }

    songs
}

async fn search_source(client: &Client, source: &str, keyword: &str, limit: usize) -> Vec<RecSong> {
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
        Err(_) => return Vec::new(),
    };
    let value: Value = match response.json().await {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    value
        .get("result")
        .and_then(|result| result.get("songs"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id").map(value_id)?;
                    let name = item
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if name.is_empty() {
                        return None;
                    }
                    let artist = item
                        .get("ar")
                        .and_then(Value::as_array)
                        .map(|items| join_names(items))
                        .unwrap_or_default();
                    let album = item
                        .get("al")
                        .and_then(|album| album.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let pic = item
                        .get("al")
                        .and_then(|album| album.get("picUrl"))
                        .and_then(Value::as_str)
                        .map(ToString::to_string);
                    Some(RecSong {
                        id: Value::String(id),
                        source: "netease".to_string(),
                        name: name.to_string(),
                        artist,
                        album,
                        pic,
                        pic_id: None,
                        url_id: None,
                        lyric_id: None,
                        types: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
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
        Err(_) => return Vec::new(),
    };
    let value: Value = match response.json().await {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    value
        .get("req")
        .and_then(|req| req.get("data"))
        .and_then(|data| data.get("body"))
        .and_then(|body| body.get("song"))
        .and_then(|song| song.get("list"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item
                        .get("mid")
                        .or_else(|| item.get("songmid"))
                        .or_else(|| item.get("id"))
                        .map(value_id)?;
                    let name = item
                        .get("name")
                        .or_else(|| item.get("title"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if name.is_empty() {
                        return None;
                    }
                    let artist = item
                        .get("singer")
                        .and_then(Value::as_array)
                        .map(|items| join_names(items))
                        .unwrap_or_default();
                    let album_value = item.get("album");
                    let album = album_value
                        .and_then(|album| album.get("name").or_else(|| album.get("title")))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let pic = album_value
                        .and_then(|album| album.get("mid"))
                        .and_then(Value::as_str)
                        .filter(|mid| !mid.is_empty())
                        .map(|mid| {
                            format!(
                                "https://y.gtimg.cn/music/photo_new/T002R500x500M000{}.jpg",
                                mid
                            )
                        });
                    Some(RecSong {
                        id: Value::String(id),
                        source: "qq".to_string(),
                        name: name.to_string(),
                        artist,
                        album,
                        pic,
                        pic_id: None,
                        url_id: None,
                        lyric_id: None,
                        types: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

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
        .get("http://search.kuwo.cn/r.s")
        .query(&params)
        .header("User-Agent", desktop_user_agent())
        .header("Referer", "http://kuwo.cn/")
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return Vec::new(),
    };
    let text = match response.text().await {
        Ok(text) => text.replace('\'', "\""),
        Err(_) => return Vec::new(),
    };
    let value: Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let mut songs: Vec<RecSong> = value
        .get("abslist")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let raw_id = item
                        .get("MUSICRID")
                        .and_then(Value::as_str)
                        .map(|value| value.trim_start_matches("MUSIC_").to_string())
                        .or_else(|| item.get("DC_TARGETID").map(value_id))?;
                    let name = clean_kuwo_text(
                        item.get("SONGNAME")
                            .or_else(|| item.get("NAME"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                    );
                    if name.is_empty() {
                        return None;
                    }
                    Some(RecSong {
                        id: Value::String(raw_id),
                        source: "kuwo".to_string(),
                        name,
                        artist: clean_kuwo_text(
                            item.get("ARTIST").and_then(Value::as_str).unwrap_or(""),
                        ),
                        album: clean_kuwo_text(
                            item.get("ALBUM").and_then(Value::as_str).unwrap_or(""),
                        ),
                        pic: None,
                        pic_id: None,
                        url_id: None,
                        lyric_id: None,
                        types: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    for song in &mut songs {
        if song.pic.is_none() {
            song.pic = fetch_kuwo_cover(client, value_id(&song.id)).await;
        }
    }

    songs
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
        .get("http://artistpicserver.kuwo.cn/pic.web")
        .query(&params)
        .header("User-Agent", desktop_user_agent())
        .header("Referer", "http://kuwo.cn/")
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

fn join_names(items: &[Value]) -> String {
    items
        .iter()
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .filter(|name| !name.trim().is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

fn value_id(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    if let Some(number) = value.as_i64() {
        return number.to_string();
    }
    if let Some(number) = value.as_u64() {
        return number.to_string();
    }
    value.to_string()
}

fn clean_kuwo_text(value: &str) -> String {
    value.replace("&nbsp;", " ").trim().to_string()
}

fn desktop_user_agent() -> &'static str {
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
}

pub fn discovery_reason(input: &str) -> String {
    privacy::short_reason(input)
}
