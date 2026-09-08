use super::*;
use crate::test_support::https::HttpsServer;
use serde_json::{json, Value};

#[tokio::test]
async fn authenticated_url_resolution_reports_verified_urls_and_sanitizes_network_failures() {
    let upstream = HttpsServer::start(json!([
        {"host":"interface3.music.163.com", "path":"/eapi/song/enhance/player/url",
         "body": r#"{"data":[{"url":"https://m701.music.126.net/test.mp3"}]}"#},
        {"host":"interface3.music.163.com", "path":"/eapi/song/enhance/player/url",
         "body": r#"{"data":[{"url":null}]}"#},
        {"host":"interface3.music.163.com", "path":"/eapi/song/enhance/player/url",
         "disconnect":true}
    ]));
    let listener = bind_local_listener().unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = ServerState {
        api_client: upstream.client.clone(),
        proxy_client: upstream.client.clone(),
        token: "http-boundary-test".into(),
        port,
    };
    let (shutdown, receiver) = tokio::sync::watch::channel(false);
    let task = tokio::spawn(start_server(state, listener, receiver));
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    for (index, expected_status) in [
        StatusCode::OK,
        StatusCode::INTERNAL_SERVER_ERROR,
        StatusCode::INTERNAL_SERVER_ERROR,
    ]
    .into_iter()
    .enumerate()
    {
        let response = client
            .get(format!(
                "http://127.0.0.1:{port}/api/url?platform=netease&id=1"
            ))
            .header(LOCAL_TOKEN_HEADER, "http-boundary-test")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), expected_status);
        let body: Value = response.json().await.unwrap();
        match index {
            0 => {
                assert_eq!(body["url"], "https://m701.music.126.net/test.mp3");
                assert!(body.get("error").is_none());
            }
            1 => {
                assert!(body["error"]
                    .as_str()
                    .is_some_and(|error| !error.is_empty()));
                assert!(body.get("url").is_none());
            }
            _ => assert_eq!(body["error"], "上游音源请求失败"),
        }
    }
    assert_eq!(upstream.calls().len(), 3);
    shutdown.send(true).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap();
}
