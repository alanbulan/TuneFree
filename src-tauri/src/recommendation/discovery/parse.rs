//! Pure parsers for platform search responses, kept free of network I/O so
//! they can be exercised against pinned response samples.

use serde_json::Value;

use crate::recommendation::model::RecSong;

pub(super) fn parse_netease_songs(value: &Value) -> Vec<RecSong> {
    value
        .get("result")
        .and_then(|result| result.get("songs"))
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(netease_song_from_value).collect())
        .unwrap_or_default()
}

fn netease_song_from_value(item: &Value) -> Option<RecSong> {
    let id = item.get("id").map(value_id)?;
    let name = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if name.is_empty() {
        return None;
    }
    let album_value = item.get("al");
    Some(RecSong {
        id: Value::String(id),
        source: "netease".to_string(),
        name: name.to_string(),
        artist: item
            .get("ar")
            .and_then(Value::as_array)
            .map(|items| join_names(items))
            .unwrap_or_default(),
        album: album_value
            .and_then(|album| album.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        pic: album_value
            .and_then(|album| album.get("picUrl"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        pic_id: None,
        url_id: None,
        lyric_id: None,
        types: None,
    })
}

pub(super) fn parse_qq_songs(value: &Value) -> Vec<RecSong> {
    value
        .get("req")
        .and_then(|req| req.get("data"))
        .and_then(|data| data.get("body"))
        .and_then(|body| body.get("song"))
        .and_then(|song| song.get("list"))
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(qq_song_from_value).collect())
        .unwrap_or_default()
}

fn qq_song_from_value(item: &Value) -> Option<RecSong> {
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
}

/// Kuwo's legacy search endpoint may quote its quasi-JSON with single
/// quotes; apostrophes inside values then arrive as `&apos;` entities.
/// Well-formed JSON is parsed as-is first so real apostrophes are never
/// corrupted by the quote swap fallback.
pub(super) fn parse_kuwo_search_json(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    if let Ok(value) = serde_json::from_str(trimmed) {
        return Some(value);
    }
    match serde_json::from_str(&trimmed.replace('\'', "\"")) {
        Ok(value) => Some(value),
        Err(error) => {
            log::warn!("酷我发现搜索响应无法解析为 JSON: {}", error);
            None
        }
    }
}

pub(super) fn parse_kuwo_songs(value: &Value) -> Vec<RecSong> {
    value
        .get("abslist")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(kuwo_song_from_value).collect())
        .unwrap_or_default()
}

fn kuwo_song_from_value(item: &Value) -> Option<RecSong> {
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
        artist: clean_kuwo_text(item.get("ARTIST").and_then(Value::as_str).unwrap_or("")),
        album: clean_kuwo_text(item.get("ALBUM").and_then(Value::as_str).unwrap_or("")),
        pic: None,
        pic_id: None,
        url_id: None,
        lyric_id: None,
        types: None,
    })
}

/// Decodes the HTML entities kuwo embeds in song metadata. `&amp;` must be
/// decoded last so escaped entity text like `&amp;lt;` is not decoded twice.
fn clean_kuwo_text(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .trim()
        .to_string()
}

fn join_names(items: &[Value]) -> String {
    items
        .iter()
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .filter(|name| !name.trim().is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) fn value_id(value: &Value) -> String {
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_netease_search_sample() {
        let value = json!({
            "result": {
                "songs": [
                    {
                        "id": 186016,
                        "name": "晴天",
                        "ar": [{ "name": "周杰伦" }, { "name": "" }],
                        "al": { "name": "叶惠美", "picUrl": "https://p1.music.126.net/cover.jpg" }
                    },
                    { "id": 2, "name": "   " }
                ]
            }
        });
        let songs = parse_netease_songs(&value);

        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].id, json!("186016"));
        assert_eq!(songs[0].name, "晴天");
        assert_eq!(songs[0].artist, "周杰伦");
        assert_eq!(songs[0].album, "叶惠美");
        assert_eq!(
            songs[0].pic.as_deref(),
            Some("https://p1.music.126.net/cover.jpg")
        );
    }

    #[test]
    fn netease_parser_tolerates_malformed_and_empty_responses() {
        assert!(parse_netease_songs(&json!({})).is_empty());
        assert!(parse_netease_songs(&json!({ "result": { "songs": "oops" } })).is_empty());
        assert!(parse_netease_songs(&json!(null)).is_empty());
    }

    #[test]
    fn parses_qq_search_sample() {
        let value = json!({
            "req": {
                "data": {
                    "body": {
                        "song": {
                            "list": [
                                {
                                    "mid": "0039MnYb",
                                    "name": "晴天",
                                    "singer": [{ "name": "周杰伦" }],
                                    "album": { "mid": "000MkMni", "name": "叶惠美" }
                                }
                            ]
                        }
                    }
                }
            }
        });
        let songs = parse_qq_songs(&value);

        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].id, json!("0039MnYb"));
        assert_eq!(songs[0].artist, "周杰伦");
        assert_eq!(
            songs[0].pic.as_deref(),
            Some("https://y.gtimg.cn/music/photo_new/T002R500x500M000000MkMni.jpg")
        );
    }

    #[test]
    fn qq_parser_tolerates_malformed_and_empty_responses() {
        assert!(parse_qq_songs(&json!({})).is_empty());
        assert!(parse_qq_songs(&json!({ "req": { "data": { "body": {} } } })).is_empty());
        assert!(parse_qq_songs(
            &json!({ "req": { "data": { "body": { "song": { "list": [{}] } } } } })
        )
        .is_empty());
    }

    #[test]
    fn parses_single_quoted_kuwo_sample_with_html_entities() {
        let text = "{'SHOW':'1','abslist':[\
            {'MUSICRID':'MUSIC_440616','SONGNAME':'King&apos;s Court','ARTIST':'Simon&amp;Garfunkel','ALBUM':'Hello&nbsp;World'},\
            {'DC_TARGETID':'474678847','NAME':'晴天','ARTIST':'周杰伦','ALBUM':''}]}";
        let value = parse_kuwo_search_json(text).unwrap();
        let songs = parse_kuwo_songs(&value);

        assert_eq!(songs.len(), 2);
        assert_eq!(songs[0].id, json!("440616"));
        assert_eq!(songs[0].name, "King's Court");
        assert_eq!(songs[0].artist, "Simon&Garfunkel");
        assert_eq!(songs[0].album, "Hello World");
        assert_eq!(songs[1].id, json!("474678847"));
        assert_eq!(songs[1].name, "晴天");
    }

    #[test]
    fn keeps_real_apostrophes_when_kuwo_returns_valid_json() {
        let text = r#"{"abslist":[{"MUSICRID":"MUSIC_1","SONGNAME":"Don't Stop","ARTIST":"Queen","ALBUM":""}]}"#;
        let value = parse_kuwo_search_json(text).unwrap();
        let songs = parse_kuwo_songs(&value);

        assert_eq!(songs[0].name, "Don't Stop");
    }

    #[test]
    fn kuwo_parser_rejects_malformed_and_tolerates_empty_responses() {
        assert!(parse_kuwo_search_json("<html>error</html>").is_none());
        assert!(parse_kuwo_search_json("").is_none());
        assert!(parse_kuwo_songs(&json!({})).is_empty());
        assert!(parse_kuwo_songs(&json!({ "abslist": [{ "MUSICRID": "MUSIC_1" }] })).is_empty());
    }

    #[test]
    fn kuwo_entity_decoding_never_double_decodes_amp() {
        assert_eq!(clean_kuwo_text("&amp;lt;tag&amp;gt;"), "&lt;tag&gt;");
        assert_eq!(clean_kuwo_text("Rock&#39;n&apos;Roll"), "Rock'n'Roll");
        assert_eq!(clean_kuwo_text("&quot;引号&quot;"), "\"引号\"");
        // 转义过的实体文本必须原样保留，不能被再解一次。
        assert_eq!(clean_kuwo_text("&amp;apos;"), "&apos;");
        assert_eq!(clean_kuwo_text("&amp;quot;"), "&quot;");
        assert_eq!(clean_kuwo_text("&amp;amp;"), "&amp;");
        assert_eq!(clean_kuwo_text("&amp;nbsp;"), "&nbsp;");
        assert_eq!(clean_kuwo_text("&amp;#39;"), "&#39;");
    }

    #[test]
    fn kuwo_entity_decoding_covers_the_full_entity_set() {
        assert_eq!(
            clean_kuwo_text("A&nbsp;B&apos;C&quot;D&lt;E&gt;F&amp;G&#39;H"),
            "A B'C\"D<E>F&G'H"
        );
        // 首尾空白（含解码出来的 &nbsp;）需要裁掉，否则会污染去重用的标准化文本。
        assert_eq!(clean_kuwo_text("&nbsp;晴天&nbsp;"), "晴天");
        assert_eq!(clean_kuwo_text(""), "");
        assert_eq!(clean_kuwo_text("没有实体"), "没有实体");
    }
}
