use super::*;
use serde_json::json;

#[test]
fn decodes_official_cookie_names_and_requires_authenticated_identity() {
    assert_eq!(decode_cookie("%u97F3%u4E50%20%uD83C%uDFB5"), "音乐 🎵");
    assert_eq!(decode_cookie("%25E9%259F%25B3%25E4%25B9%2590"), "音乐");
    assert_eq!(decode_cookie("%invalid"), "%invalid");
    assert!(parse_account("userid=0; sid=private").is_err());
    let session = parse_account("userid=123; sid=session_suffix; uname3=%u97F3%u4E50; pic3=https%3A%2F%2Fimg1.kuwo.cn%2Favatar.jpg").unwrap();
    assert_eq!(session.account.nickname, "音乐");
    assert_eq!(
        session.account.avatar_url.as_deref(),
        Some("https://img1.kuwo.cn/avatar.jpg")
    );
    assert!(!serde_json::to_string(&session.account)
        .unwrap()
        .contains("session_suffix"));
}

#[test]
fn website_portrait_cookie_decoding_falls_back_after_an_invalid_primary_value() {
    for (cookie, expected) in [
        (
            "pic3=http%253A%252F%252Fkwimg1.kuwo.cn%252Favatar.jpg",
            "https://kwimg1.kuwo.cn/avatar.jpg",
        ),
        (
            "pic3=%2F%2Fthirdwx.qlogo.cn%2Fmmopen%2Favatar%2F132",
            "https://thirdwx.qlogo.cn/mmopen/avatar/132",
        ),
        (
            "pic3=%u0068%u0074%u0074%u0070%u0073%u003A%u002F%u002Fkwimg1.kuwo.cn/avatar.jpg",
            "https://kwimg1.kuwo.cn/avatar.jpg",
        ),
        (
            "pic3=undefined; pic=https%3A%2F%2Fkwimg2.kuwo.cn%2Favatar.jpg",
            "https://kwimg2.kuwo.cn/avatar.jpg",
        ),
        (
            "pic3=javascript%3Aalert(1); pic=https%3A%2F%2Fkwimg2.kuwo.cn%2Favatar.jpg",
            "https://kwimg2.kuwo.cn/avatar.jpg",
        ),
    ] {
        let session = parse_account(&format!("userid=123; sid=fixture; {cookie}")).unwrap();
        assert_eq!(session.account.avatar_url.as_deref(), Some(expected));
    }
    let session =
        parse_account("userid=123; sid=fixture; uname3=%20; username=%u97F3%u4E50; pic3=undefined")
            .unwrap();
    assert_eq!(session.account.nickname, "音乐");
    assert!(session.account.avatar_url.is_none());
}

#[cfg(any(windows, target_os = "macos"))]
#[tokio::test]
async fn checks_the_web_session_in_a_form_and_never_treats_public_uid_as_login() {
    use crate::test_support::https::HttpsServer;
    let server = HttpsServer::start(json!([
        {"host":"www.kuwo.cn","path":"/api/user/checkLogin","body":"{\"status\":200}"},
        {"host":"www.kuwo.cn","path":"/api/user/checkLogin","body":"{\"status\":401}"}
    ]));
    let cookie = "userid=123; sid=private-session_suffix; uname3=fixture";
    assert!(account(&server.client, cookie).await.is_ok());
    let calls = server.calls();
    assert_eq!(calls[0]["query"], json!({}));
    assert_eq!(calls[0]["headers"]["cookie"], cookie);
    assert_eq!(calls[0]["body"], "uid=123&sid=private-session");
    assert_eq!(
        account(&server.client, cookie).await.err().unwrap().code,
        crate::app::error::ErrorCode::AuthRequired
    );
    assert!(account(&server.client, "userid=123").await.is_err());
    assert_eq!(server.calls().len(), 2);
}

#[cfg(any(windows, target_os = "macos"))]
#[tokio::test]
async fn library_preview_uses_newver_and_complete_import_checks_every_page() {
    use crate::test_support::https::HttpsServer;
    let song = |id| json!({"id":format!("MUSIC_{id}"),"name":format!("song{id}"),"artist":"artist&guest","album":"album"});
    let first: Vec<_> = (1..=20).map(song).collect();
    let server = HttpsServer::start(json!([
        {"host":"nplserver.kuwo.cn","path":"/pl.svc","body":json!({"result":"ok","plist":[{"id":"42","title":"fixture","uid":123,"type":"GENERAL","musicnum":21}]}).to_string()},
        {"host":"nplserver.kuwo.cn","path":"/pl.svc","body":json!({"result":"ok","title":"fixture","total":21,"validtotal":0,"musiclist":first}).to_string()},
        {"host":"nplserver.kuwo.cn","path":"/pl.svc","body":json!({"result":"ok","title":"fixture","total":21,"validtotal":0,"musiclist":[song(21)]}).to_string()}
    ]));
    let session = parse_account("userid=123; sid=session; uname3=fixture").unwrap();
    let lists = playlists(&server.client, &session).await.unwrap();
    assert_eq!(lists[0].kind, "created");
    let payload = import(&server.client, &session, "42").await.unwrap();
    assert_eq!(payload.songs.len(), 21);
    assert_eq!(payload.songs[20].id, "21");
    assert_eq!(payload.songs[0].artist, "artist, guest");
    let calls = server.calls();
    assert_eq!(calls[1]["query"]["pcmp4"], "1");
    assert_eq!(calls[1]["query"]["newver"], "1");
    assert_eq!(calls[1]["query"]["rn"], "20");
    assert_eq!(calls[2]["query"]["pn"], "1");
    let incomplete = HttpsServer::start(
        json!([{"host":"nplserver.kuwo.cn","path":"/pl.svc","body":json!({"result":"ok","title":"fixture","total":21,"validtotal":21,"musiclist":[]}).to_string()}]),
    );
    assert!(preview(&incomplete.client, &session, "42", 1)
        .await
        .is_err());
    assert!(preview(&incomplete.client, &session, "42", 0)
        .await
        .is_err());
}
