use super::*;
use crate::test_support::https::HttpsServer;
use serde_json::json;

#[tokio::test]
async fn playback_providers_send_their_real_protocol_and_resolve_signed_urls() {
    let url = "https://audio.example.com/track.mp3?signature=test";
    let server = HttpsServer::start(json!([
        {"host":"interface3.music.163.com","path":"/eapi/song/enhance/player/url","body":json!({"data":[{"url":url}]}).to_string()},
        {"host":"u.y.qq.com","path":"/cgi-bin/musicu.fcg","body":json!({"queryvkey":{"data":{"midurlinfo":[{"purl":url}]}}}).to_string()},
        {"host":"mobi.kuwo.cn","path":"/mobi.s","body":format!("url={url}\r\n")}
    ]));
    let providers: Vec<Box<dyn MusicProvider>> = vec![
        Box::new(netease::NeteaseProvider),
        Box::new(qq::QqProvider),
        Box::new(kuwo::KuwoProvider),
    ];
    for (provider, name) in providers.into_iter().zip(["netease", "qq", "kuwo"]) {
        assert_eq!(provider.platform(), name);
        assert_eq!(
            provider
                .get_url(&server.client, "123", "flac")
                .await
                .unwrap(),
            url
        );
    }
    let calls = server.calls();
    assert_eq!(calls.len(), 3);
    assert!(calls.iter().all(|call| call["unexpected"] == false));
    assert_eq!(calls[0]["method"], "POST");
    assert!(calls[0]["body"].as_str().unwrap().starts_with("params="));
    assert_eq!(calls[0]["headers"]["cookie"], "os=pc;");
    assert_eq!(calls[1]["headers"]["origin"], "https://y.qq.com");
    assert!(calls[2]["query"]["q"]
        .as_str()
        .is_some_and(|q| !q.is_empty()));
}

#[tokio::test]
async fn playback_provider_http_errors_are_distinct_from_vip_or_missing_audio() {
    let server = HttpsServer::start(json!([
        {"host":"interface3.music.163.com","path":"/eapi/song/enhance/player/url","status":503,"body":"{}"},
        {"host":"u.y.qq.com","path":"/cgi-bin/musicu.fcg","status":403,"body":"{}"},
        {"host":"mobi.kuwo.cn","path":"/mobi.s","status":500,"body":""}
    ]));
    let providers: Vec<Box<dyn MusicProvider>> = vec![
        Box::new(netease::NeteaseProvider),
        Box::new(qq::QqProvider),
        Box::new(kuwo::KuwoProvider),
    ];
    for provider in providers {
        assert!(matches!(
            provider.get_url(&server.client, "123", "128k").await,
            Err(ApiError::Network(_))
        ));
    }
    assert_eq!(server.calls().len(), 3);
}

#[tokio::test]
async fn qq_rejects_unusable_stream_paths_and_schemes() {
    for (purl, base, detail) in [
        (
            "file:///C:/song.mp3",
            "https://audio.example.com/",
            "unsupported stream URL scheme",
        ),
        ("song.mp3", "data:text/plain,audio", "invalid stream path"),
    ] {
        let server = HttpsServer::start(json!([{
            "host":"u.y.qq.com", "path":"/cgi-bin/musicu.fcg",
            "body":json!({"queryvkey":{"data":{
                "sip":[base], "midurlinfo":[{"purl":purl}]
            }}}).to_string()
        }]));
        let error = qq::QqProvider
            .get_url(&server.client, "123", "flac")
            .await
            .unwrap_err();
        assert!(matches!(error, ApiError::Parse(_)));
        assert!(error.to_string().contains(detail));
    }
}

#[tokio::test]
async fn kuwo_unknown_quality_uses_the_default_and_missing_urls_keep_diagnostics_private() {
    let server = HttpsServer::start(json!([{
        "host":"mobi.kuwo.cn", "path":"/mobi.s", "body":"internal_upstream=private-host"
    }, {
        "host":"mobi.kuwo.cn", "path":"/mobi.s", "body":"internal_upstream=private-host"
    }]));
    for quality in ["128k", "unknown"] {
        let error = kuwo::KuwoProvider
            .get_url(&server.client, "123", quality)
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "Parse error: Kuwo response did not contain a playable url"
        );
    }
    let calls = server.calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0]["query"], calls[1]["query"]);
}

#[test]
fn api_error_serialization_preserves_the_public_error_message() {
    for error in [
        ApiError::Parse("invalid \"payload\"\n".into()),
        ApiError::VipContent,
        ApiError::UnsupportedPlatform("unsupported".into()),
        ApiError::Io(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
    ] {
        let encoded = serde_json::to_string(&error).unwrap();
        assert_eq!(
            serde_json::from_str::<String>(&encoded).unwrap(),
            error.to_string()
        );
    }
}
