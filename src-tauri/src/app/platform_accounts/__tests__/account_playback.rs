use super::*;
use crate::test_support::https::HttpsServer;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicU64},
    Arc,
};

fn reply(host: &str, path: &str, data: Value) -> Value {
    json!({"host":host,"path":path,"body":data.to_string()})
}
fn qq_reply(data: Value) -> Value {
    reply(
        "u.y.qq.com",
        "/cgi-bin/musics.fcg",
        json!({"code":0,"req":{"code":0,"data":data}}),
    )
}
fn state(server: &HttpsServer, session: Session) -> PlatformAccountState {
    let mut sessions = std::collections::HashMap::new();
    sessions.insert(Platform::parse(&session.account.platform).unwrap(), session);
    PlatformAccountState(Arc::new(super::super::Inner {
        initialized: AtomicBool::new(true),
        sessions: parking_lot::Mutex::new(sessions),
        attempts: parking_lot::Mutex::new(Default::default()),
        operations: tokio::sync::Mutex::new(()),
        revisions: [AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0)],
        app: parking_lot::Mutex::new(None),
        client: server.client.clone(),
    }))
}

#[tokio::test]
async fn account_qq_uses_signed_track_info_and_selects_the_first_complete_grant() {
    let server = HttpsServer::start(json!([
        qq_reply(
            json!({"tracks":[{"file":{"media_mid":"MEDIA","size_hires":0,"size_flac":12,"size_320mp3":10,"size_128mp3":8}}]})
        ),
        qq_reply(
            json!({"sip":["https://ws.stream.qqmusic.qq.com/"],"midurlinfo":[
            {"filename":"F000MEDIASONG.flac","purl":""},{"filename":"M800MEDIASONG.mp3","purl":"M800MEDIASONG.mp3?vkey=fixture"},
            {"filename":"M500MEDIASONG.mp3","purl":"M500MEDIASONG.mp3?vkey=fixture"}]})
        )
    ]));
    let session = super::super::qq::parse_account(
        json!({"info":{"nick":"fixture"}}),
        "qqmusic_uin=123; qqmusic_key=private-fixture",
    )
    .unwrap();
    let state = state(&server, session);
    let result = state
        .resolve_account_url("qq", "SONG", "flac24bit", None, &[])
        .await
        .unwrap();
    assert_eq!(result.quality.as_deref(), Some("320k"));
    assert!(result.url.unwrap().contains("M800MEDIASONG"));
    let calls = server.calls();
    let body: Value = serde_json::from_str(calls[1]["body"].as_str().unwrap()).unwrap();
    assert_eq!(body["comm"]["authst"], "private-fixture");
    let guid = body["req"]["param"]["guid"].as_str().unwrap();
    assert_eq!(guid.len(), 10);
    assert!(guid.bytes().all(|byte| byte.is_ascii_digit()));
    assert_eq!(body["req"]["param"]["filename"][0], "F000MEDIASONG.flac");
    assert!(!calls[1]["query"].to_string().contains("private-fixture"));
    assert!(calls[1]["query"]["sign"]
        .as_str()
        .unwrap()
        .starts_with("zzc"));
}

#[tokio::test]
async fn netease_uses_v1_and_skips_trials_rejected_urls_and_unauthorized_grants() {
    let endpoint = "/eapi/song/enhance/player/url/v1";
    let server = HttpsServer::start(json!([
        reply(
            "interface3.music.163.com",
            endpoint,
            json!({"code":200,"data":[{"id":123,"url":"https://m701.music.126.net/trial.mp3","freeTrialInfo":{"start":0,"end":30}}]})
        ),
        reply(
            "interface3.music.163.com",
            endpoint,
            json!({"code":200,"data":[{"id":123,"url":"https://m701.music.126.net/song.mp3","level":"standard"}]})
        ),
        reply("interface3.music.163.com", endpoint, json!({"code":301}))
    ]));
    let session = super::super::netease::parse_account(
        json!({"code":200,"profile":{"userId":1,"nickname":"fixture"}}),
        "MUSIC_U=private-fixture",
    )
    .unwrap();
    let state = state(&server, session);
    let first = state
        .resolve_account_url("netease", "123", "320k", None, &[])
        .await
        .unwrap();
    assert_eq!(first.quality.as_deref(), Some("128k"));
    let second = state
        .resolve_account_url("netease", "123", "128k", None, &[])
        .await
        .unwrap();
    assert_eq!(second.state, "expired");
    assert!(state.session(Platform::Netease).await.is_err());
    let calls = server.calls();
    assert!(calls.iter().all(|call| call["query"] == json!({})));
    assert!(calls[0]["body"].as_str().unwrap().starts_with("params="));
}

#[tokio::test]
async fn kuwo_playback_checks_account_and_sends_secret_and_session_only_to_fixed_https_origin() {
    let server = HttpsServer::start(json!([
        reply("www.kuwo.cn", "/api/user/checkLogin", json!({"status":200})),
        reply(
            "www.kuwo.cn",
            "/api/v1/www/music/playUrl",
            json!({"code":200,"data":{"url":"https://er-sycdn.kuwo.cn/fixture/song.mp3"}})
        )
    ]));
    let cookie = format!(
        "userid=123; sid=private-fixture; {}=0123456789abcdef0123456789abcdef",
        super::super::cookies::KUWO_WEB_COOKIE
    );
    let session = super::super::kuwo::account(
        &HttpsServer::start(json!([reply(
            "www.kuwo.cn",
            "/api/user/checkLogin",
            json!({"status":200})
        )]))
        .client,
        &cookie,
    )
    .await
    .unwrap();
    let state = state(&server, session);
    assert_eq!(
        state
            .resolve_account_url("kuwo", "123", "128k", None, &[])
            .await
            .unwrap()
            .state,
        "connected"
    );
    let calls = server.calls();
    assert_eq!(calls[1]["headers"]["cookie"], cookie);
    assert_eq!(calls[1]["headers"]["secret"].as_str().unwrap().len(), 72);
    assert_eq!(calls[1]["query"]["br"], "128kmp3");
    assert!(!calls[1]["query"].to_string().contains("private-fixture"));
}

#[test]
fn playback_urls_cannot_inject_credentials_or_point_to_unrelated_hosts() {
    assert_eq!(
        playback_url(Platform::Qq, "http://ws.stream.qqmusic.qq.com/a.mp3").unwrap(),
        "https://ws.stream.qqmusic.qq.com/a.mp3"
    );
    for raw in [
        "https://evil.test/a.mp3",
        "https://ws.stream.qqmusic.qq.com.evil.test/a.mp3",
        "https://user:pass@ws.stream.qqmusic.qq.com/a.mp3",
        "file:///tmp/a",
        "https://ws.stream.qqmusic.qq.com:9999/a",
    ] {
        assert!(playback_url(Platform::Qq, raw).is_err());
    }
}
