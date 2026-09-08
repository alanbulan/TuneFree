use super::*;
use crate::recommendation::{discovery::discover_songs, llm::DiscoverySearchQuery};
use crate::test_support::https::HttpsServer;

fn netease_body() -> String {
    json!({"result":{"songs":[
        {"id":1,"name":"共同歌曲","ar":[{"name":"甲"}],"al":{"name":"专辑","picUrl":"https://example.com/one.jpg"}},
        {"id":2,"name":"网易独有","ar":[{"name":"乙"}]}
    ]}}).to_string()
}
fn qq_body() -> String {
    json!({"req":{"data":{"body":{"song":{"list":[
        {"mid":"duplicate","name":"共同歌曲","singer":[{"name":"甲"}]},
        {"mid":"new","name":"QQ 独有","singer":[{"name":"丙"}],"album":{"name":"专辑","mid":"album"}}
    ]}}}}}).to_string()
}
fn kuwo_body() -> String {
    json!({"abslist":[
        {"MUSICRID":"MUSIC_3","SONGNAME":"酷我独有","ARTIST":"丁","ALBUM":"专辑"},
        {"MUSICRID":"MUSIC_4","SONGNAME":"无封面","ARTIST":"戊"}
    ]})
    .to_string()
}
fn replies() -> Value {
    json!([
        {"host":"music.163.com","path":"/api/cloudsearch/pc","body":netease_body()},
        {"host":"u.y.qq.com","path":"/cgi-bin/musicu.fcg","body":qq_body()},
        {"host":"search.kuwo.cn","path":"/r.s","body":kuwo_body()},
        {"host":"artistpicserver.kuwo.cn","path":"/pic.web","body":"https://example.com/cover.jpg"},
        {"host":"artistpicserver.kuwo.cn","path":"/pic.web","body":"not a cover"}
    ])
}
fn query() -> DiscoverySearchQuery {
    DiscoverySearchQuery {
        keyword: "测试歌手".into(),
        source: "all".into(),
        reason: "基于歌手偏好".into(),
    }
}

#[tokio::test]
async fn discovery_uses_all_real_https_request_shapes_and_deduplicates_results_in_source_order() {
    let server = HttpsServer::start(replies());
    let songs = discover_songs(server.client.clone(), vec![query()], 4, 20).await;
    assert_eq!(songs.len(), 5);
    assert_eq!(
        songs
            .iter()
            .map(|entry| entry.song.name.as_str())
            .collect::<Vec<_>>(),
        ["共同歌曲", "网易独有", "QQ 独有", "酷我独有", "无封面"]
    );
    assert!(songs.iter().all(|song| song.reason == "基于歌手偏好"));
    assert_eq!(
        songs
            .iter()
            .filter(|song| song.song.source == "kuwo" && song.song.pic.is_some())
            .count(),
        1
    );
    let calls = server.calls();
    assert_eq!(calls.len(), 5);
    assert!(calls.iter().all(|call| call["unexpected"] == false));
    let netease = calls
        .iter()
        .find(|call| call["host"] == "music.163.com")
        .unwrap();
    assert_eq!(netease["query"]["s"], "测试歌手");
    assert_eq!(netease["query"]["limit"], "4");
    let qq = calls
        .iter()
        .find(|call| call["host"] == "u.y.qq.com")
        .unwrap();
    let body: Value = serde_json::from_str(qq["body"].as_str().unwrap()).unwrap();
    assert_eq!(body["req"]["param"]["query"], "测试歌手");
    assert_eq!(body["req"]["param"]["num_per_page"], 4);
    assert_eq!(
        qq["headers"]["referer"],
        "https://y.qq.com/portal/search.html"
    );
    let kuwo = calls
        .iter()
        .find(|call| call["host"] == "search.kuwo.cn")
        .unwrap();
    assert_eq!(kuwo["query"]["all"], "测试歌手");
    assert_eq!(kuwo["query"]["rn"], "4");
    assert!(fetch_kuwo_cover(&server.client, "  ".into())
        .await
        .is_none());
    assert!(search_source(&server.client, "unsupported", "unused", 4)
        .await
        .is_empty());
}

#[tokio::test]
async fn discovery_stops_at_the_total_limit_after_cross_source_deduplication() {
    let server = HttpsServer::start(replies());
    let songs = discover_songs(server.client.clone(), vec![query()], 4, 3).await;
    assert_eq!(songs.len(), 3);
    assert_eq!(songs[2].song.source, "qq");
    assert_eq!(server.calls().len(), 5);
}

#[tokio::test]
async fn each_search_source_recovers_from_invalid_json_disconnected_and_truncated_responses() {
    for failure in [
        json!({"body":"not-json"}),
        json!({"body":"","disconnect":true}),
        json!({"body":"x","length":80}),
    ] {
        let mut plan = Vec::new();
        for (host, path) in [
            ("music.163.com", "/api/cloudsearch/pc"),
            ("u.y.qq.com", "/cgi-bin/musicu.fcg"),
            ("search.kuwo.cn", "/r.s"),
        ] {
            let mut response = failure.clone();
            response["host"] = json!(host);
            response["path"] = json!(path);
            plan.push(response);
        }
        let server = HttpsServer::start(json!(plan));
        for source in ["netease", "qq", "kuwo"] {
            assert!(search_source(&server.client, source, "请求失败", 4)
                .await
                .is_empty());
        }
        assert_eq!(server.calls().len(), 3);
    }
}
