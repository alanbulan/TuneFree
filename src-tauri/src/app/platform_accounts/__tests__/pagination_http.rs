use super::*;
use crate::test_support::https::HttpsServer;
use serde_json::{json, Value};

fn netease_session() -> Session {
    netease::parse_account(
        json!({"code":200,"profile":{"userId":123,"nickname":"fixture"}}),
        "MUSIC_U=test-session",
    )
    .unwrap()
}

fn qq_session() -> Session {
    qq::parse_account(
        json!({"info":{"nick":"fixture","encryptUin":"test-encrypted-id"}}),
        "qqmusic_uin=123; qqmusic_key=test-session",
    )
    .unwrap()
}

fn reply(host: &str, path: &str, data: Value) -> Value {
    json!({"host":host,"path":path,"body":data.to_string()})
}

fn qq_reply(data: Value) -> Value {
    reply(
        "u.y.qq.com",
        "/cgi-bin/musicu.fcg",
        json!({"code":0,"req":{"code":0,"data":data}}),
    )
}

fn netease_list(id: u64) -> Value {
    json!({"id":id,"name":format!("playlist{id}"),"trackCount":1,"creator":{"userId":123}})
}

fn netease_song(id: u64) -> Value {
    json!({"id":id,"name":format!("song{id}"),"ar":[{"name":"artist"}],"al":{"name":"album"}})
}

fn qq_list(id: u64) -> Value {
    json!({"tid":id,"dirid":2,"title":format!("playlist{id}"),"songnum":1})
}

fn qq_song(id: u64) -> Value {
    json!({"mid":format!("MID{id}"),"id":id,"name":format!("song{id}"),"singer":[{"name":"artist"}],"album":{"name":"album"}})
}

#[tokio::test]
async fn netease_fetches_every_playlist_page_and_rejects_nonadvancing_pages() {
    let page_one: Vec<_> = (1..=100).map(netease_list).collect();
    let server = HttpsServer::start(json!([
        reply(
            "music.163.com",
            "/api/user/playlist",
            json!({"code":200,"playlist":page_one,"more":true})
        ),
        reply(
            "music.163.com",
            "/api/user/playlist",
            json!({"code":200,"playlist":[netease_list(100),netease_list(101)],"more":false})
        )
    ]));
    let result = netease::playlists(&server.client, &netease_session())
        .await
        .unwrap();
    assert_eq!(result.len(), 101);
    assert_eq!(result[100].id, "101");
    let calls = server.calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0]["query"]["offset"], "0");
    assert_eq!(calls[1]["query"]["offset"], "100");
    assert_eq!(calls[1]["headers"]["cookie"], "MUSIC_U=test-session");
    let repeated = json!({"code":200,"playlist":[netease_list(1)],"more":true});
    let server = HttpsServer::start(json!([
        reply("music.163.com", "/api/user/playlist", repeated.clone()),
        reply("music.163.com", "/api/user/playlist", repeated)
    ]));
    assert!(netease::playlists(&server.client, &netease_session())
        .await
        .is_err());
    assert_eq!(server.calls().len(), 2);
}

#[tokio::test]
async fn netease_fetches_missing_song_batches_and_preserves_full_playlist_order() {
    let ids: Vec<_> = (1..=225).map(|id| json!({"id":id})).collect();
    let initial: Vec<_> = (1..=5).rev().map(netease_song).collect();
    let mut replies = vec![reply(
        "music.163.com",
        "/api/v6/playlist/detail",
        json!({
            "code":200,"playlist":{"name":"long playlist","trackIds":ids,"trackCount":225,"tracks":initial}
        }),
    )];
    for range in [6..=105, 106..=205, 206..=225] {
        let songs: Vec<_> = range.rev().map(netease_song).collect();
        replies.push(reply(
            "music.163.com",
            "/api/v3/song/detail",
            json!({"code":200,"songs":songs}),
        ));
    }
    let server = HttpsServer::start(json!(replies));
    let result = netease::import(&server.client, &netease_session(), "42")
        .await
        .unwrap();
    assert_eq!(result.songs.len(), 225);
    assert_eq!(result.songs[0].id, "1");
    assert_eq!(result.songs[224].id, "225");
    let calls = server.calls();
    assert_eq!(calls.len(), 4);
    let sizes: Vec<_> = calls[1..]
        .iter()
        .map(|call| {
            let ids: Value = serde_json::from_str(call["query"]["c"].as_str().unwrap()).unwrap();
            ids.as_array().unwrap().len()
        })
        .collect();
    assert_eq!(sizes, vec![100, 100, 20]);
}

#[tokio::test]
async fn netease_does_not_import_when_a_song_batch_is_incomplete() {
    let server = HttpsServer::start(json!([
        reply(
            "music.163.com",
            "/api/v6/playlist/detail",
            json!({"code":200,"playlist":{
                "name":"incomplete","trackIds":[{"id":1},{"id":2}],"trackCount":2,"tracks":[]
            }})
        ),
        reply(
            "music.163.com",
            "/api/v3/song/detail",
            json!({"code":200,"songs":[netease_song(1)]})
        )
    ]));
    assert!(netease::import(&server.client, &netease_session(), "42")
        .await
        .is_err());
}

#[tokio::test]
async fn qq_reads_created_and_every_collected_page_without_duplicates() {
    let first: Vec<_> = (2..=101).map(qq_list).collect();
    let server = HttpsServer::start(json!([
        qq_reply(json!({"v_playlist":[qq_list(1)],"bFinish":true})),
        qq_reply(json!({"v_list":first,"hasmore":1})),
        qq_reply(json!({"v_list":[qq_list(101),qq_list(102)],"hasmore":0}))
    ]));
    let result = qq::playlists(&server.client, &qq_session()).await.unwrap();
    assert_eq!(result.len(), 102);
    assert_eq!(result[0].kind, "created");
    assert_eq!(result[101].kind, "collected");
    let calls = server.calls();
    assert_eq!(calls.len(), 3);
    let payloads: Vec<Value> = calls
        .iter()
        .map(|call| serde_json::from_str(call["body"].as_str().unwrap()).unwrap())
        .collect();
    assert_eq!(payloads[1]["req"]["param"]["uin"], "test-encrypted-id");
    assert_eq!(payloads[1]["req"]["param"]["offset"], 0);
    assert_eq!(payloads[2]["req"]["param"]["offset"], 100);
    assert!(calls
        .iter()
        .all(|call| call["query"].as_object().unwrap().is_empty()));
    let server = HttpsServer::start(json!([qq_reply(json!({"v_playlist":[],"bFinish":false}))]));
    assert!(qq::playlists(&server.client, &qq_session()).await.is_err());
    assert_eq!(server.calls().len(), 1);
}

#[tokio::test]
async fn qq_reads_all_song_pages_and_rejects_changed_or_incomplete_totals() {
    let mut replies = Vec::new();
    for (range, more) in [(1..=100, 1), (101..=200, 1), (201..=225, 0)] {
        let songs: Vec<_> = range.map(qq_song).collect();
        replies.push(qq_reply(json!({"dirinfo":{"title":"long playlist"},"songlist":songs,"total_song_num":225,"hasmore":more})));
    }
    let server = HttpsServer::start(json!(replies));
    let result = qq::import(&server.client, &qq_session(), "42")
        .await
        .unwrap();
    assert_eq!(result.songs.len(), 225);
    assert_eq!(result.songs[0].id, "MID1");
    assert_eq!(result.songs[224].id, "MID225");
    let offsets: Vec<_> = server
        .calls()
        .iter()
        .map(|call| {
            let body: Value = serde_json::from_str(call["body"].as_str().unwrap()).unwrap();
            body["req"]["param"]["song_begin"].as_u64().unwrap()
        })
        .collect();
    assert_eq!(offsets, vec![0, 100, 200]);
    for total in [1, 3] {
        let server = HttpsServer::start(json!([
            qq_reply(
                json!({"dirinfo":{"title":"incomplete"},"songlist":[qq_song(1)],"total_song_num":2,"hasmore":1})
            ),
            qq_reply(json!({"songlist":[qq_song(2)],"total_song_num":total,"hasmore":0}))
        ]));
        assert!(qq::import(&server.client, &qq_session(), "42")
            .await
            .is_err());
    }
}
