use crate::api::{netease::get_netease_url_with_cookie, qq::get_qq_url_with_cookie, ApiError};
use crate::test_support::https::HttpsServer;
use serde_json::{json, Value};

#[tokio::test]
async fn authenticated_qq_playback_keeps_session_in_post_body_and_media_mid_in_filename() {
    let server = HttpsServer::start(json!([{
        "host":"u.y.qq.com","path":"/cgi-bin/musicu.fcg",
        "body":json!({"queryvkey":{"data":{"midurlinfo":[{"purl":"https://audio.example.com/song.mp3"}]}}}).to_string()
    }]));
    let cookie = "qqmusic_uin=123; qqmusic_key=private-test-session";
    let result = get_qq_url_with_cookie(
        &server.client,
        "SONGMID",
        "320k",
        Some(cookie),
        Some("MEDIAMID"),
    )
    .await
    .unwrap();
    assert_eq!(result, "https://audio.example.com/song.mp3");
    let calls = server.calls();
    assert_eq!(calls[0]["method"], "POST");
    assert_eq!(calls[0]["query"], json!({}));
    assert_eq!(calls[0]["headers"]["cookie"], cookie);
    let body: Value = serde_json::from_str(calls[0]["body"].as_str().unwrap()).unwrap();
    assert_eq!(body["comm"]["authst"], "private-test-session");
    assert_eq!(body["queryvkey"]["param"]["uin"], 123);
    assert_eq!(body["queryvkey"]["param"]["songmid"], json!(["SONGMID"]));
    assert_eq!(
        body["queryvkey"]["param"]["filename"],
        json!(["M800MEDIAMIDMEDIAMID.mp3"])
    );
}

#[tokio::test]
async fn authenticated_playback_errors_remove_request_url_before_logging() {
    let server = HttpsServer::start(json!([
        {"host":"u.y.qq.com","path":"/cgi-bin/musicu.fcg","status":503,"body":"{}"},
        {"host":"interface3.music.163.com","path":"/eapi/song/enhance/player/url","status":503,"body":"{}"}
    ]));
    let qq = get_qq_url_with_cookie(
        &server.client,
        "SONGMID",
        "128k",
        Some("qqmusic_uin=123; qqmusic_key=private-test-session"),
        None,
    )
    .await
    .unwrap_err();
    let netease = get_netease_url_with_cookie(
        &server.client,
        "123",
        "128k",
        "MUSIC_U=private-test-session",
    )
    .await
    .unwrap_err();
    for error in [qq, netease] {
        if let ApiError::Network(error) = error {
            assert!(error.url().is_none());
            assert!(!error.to_string().contains("private-test-session"));
        } else {
            panic!("expected a sanitized network error");
        }
    }
}
