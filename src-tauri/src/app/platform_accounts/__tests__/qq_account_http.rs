use super::*;
use crate::test_support::https::HttpsServer;

fn reply(code: i64, data: Value) -> Value {
    json!({"host":"u.y.qq.com","path":"/cgi-bin/musicu.fcg",
        "body":json!({"code":0,"req":{"code":code,"data":data}}).to_string()})
}

fn login() -> Value {
    reply(
        0,
        json!({"info":{"nick":"fixture","encryptUin":"current-encrypted-id"}}),
    )
}

#[tokio::test]
async fn login_looks_up_the_current_users_website_portrait_separately() {
    let cookie = "qqmusic_uin=123; qqmusic_key=test-session";
    let server = HttpsServer::start(json!([
        login(),
        reply(
            0,
            json!({"code":0,"map_userinfo":{
                "456":{"uin":456,"headurl":"https://thirdqq.qlogo.cn/g/other/100"},
                "123":{"uin":123,"headurl":"http://thirdqq.qlogo.cn/g/current/100"}
            }})
        )
    ]));
    let session = account(&server.client, cookie).await.unwrap();
    assert_eq!(session.account.nickname, "fixture");
    assert_eq!(
        session.account.avatar_url.as_deref(),
        Some("https://thirdqq.qlogo.cn/g/current/100")
    );
    assert_eq!(session.cookie, cookie);
    let calls = server.calls();
    assert_eq!(calls.len(), 2);
    let body: Value = serde_json::from_str(calls[1]["body"].as_str().unwrap()).unwrap();
    assert_eq!(body["req"]["module"], "userInfo.BaseUserInfoServer");
    assert_eq!(body["req"]["method"], "get_user_baseinfo_v2");
    assert_eq!(body["req"]["param"]["vec_uin"], json!(["123"]));
    assert_eq!(calls[1]["headers"]["cookie"], cookie);
    assert_eq!(calls[1]["headers"]["referer"], "https://y.qq.com/");
}

#[tokio::test]
async fn wechat_music_identity_uses_the_returned_homepage_avatar_and_encrypted_id() {
    let cookie = "wxuin=1152921504000000001; qqmusic_key=W_X-test; tmeLoginType=1";
    let server = HttpsServer::start(json!([
        login(),
        reply(0, json!({"code":0,"map_userinfo":{}})),
        reply(
            0,
            json!({"Info":{"BaseInfo":{
                "EncryptedUin":"current-encrypted-id","Avatar":"//thirdwx.qlogo.cn/mmopen/current/132"
            }}})
        )
    ]));
    let session = account(&server.client, cookie).await.unwrap();
    assert_eq!(session.account.user_id, "1152921504000000001");
    assert_eq!(
        session.account.avatar_url.as_deref(),
        Some("https://thirdwx.qlogo.cn/mmopen/current/132")
    );
    let calls = server.calls();
    assert_eq!(calls.len(), 3);
    let body: Value = serde_json::from_str(calls[2]["body"].as_str().unwrap()).unwrap();
    assert_eq!(
        body["req"]["module"],
        "music.UnifiedHomepage.UnifiedHomepageSrv"
    );
    assert_eq!(body["req"]["method"], "GetHomepageHeader");
    assert_eq!(body["req"]["param"]["uin"], "current-encrypted-id");
    assert_eq!(body["comm"]["tmeLoginType"], 1);
}

#[tokio::test]
async fn portrait_failure_is_optional_but_does_not_bypass_login_validation() {
    for base in [
        reply(1000, json!({})),
        reply(
            0,
            json!({"code":0,"map_userinfo":{"456":{"uin":456,"headurl":"https://thirdqq.qlogo.cn/g/other/100"}}}),
        ),
        reply(
            0,
            json!({"code":0,"map_userinfo":{"123":{"uin":456,"headurl":"https://thirdqq.qlogo.cn/g/other/100"}}}),
        ),
        reply(
            0,
            json!({"code":0,"map_userinfo":{"123":{"uin":123,"headurl":"javascript:alert(1)"}}}),
        ),
        reply(
            0,
            json!({"code":1,"map_userinfo":{"123":{"uin":123,"headurl":"https://thirdqq.qlogo.cn/g/current/100"}}}),
        ),
        reply(
            0,
            json!({"code":0,"map_userinfo":{"123":{"headurl":"https://thirdqq.qlogo.cn/g/current/100"}}}),
        ),
    ] {
        let server = HttpsServer::start(json!([
            login(),
            base,
            reply(
                0,
                json!({"Info":{"BaseInfo":{"EncryptedUin":"other-id","Avatar":"https://thirdqq.qlogo.cn/g/other/100"}}})
            )
        ]));
        let session = account(&server.client, "qqmusic_uin=123; qqmusic_key=fixture")
            .await
            .unwrap();
        assert_eq!(session.account.state, "connected");
        assert!(session.account.avatar_url.is_none());
    }
    let server = HttpsServer::start(json!([reply(1000, json!({}))]));
    assert!(
        account(&server.client, "qqmusic_uin=123; qqmusic_key=fixture")
            .await
            .is_err()
    );
    assert_eq!(server.calls().len(), 1);
}

#[tokio::test]
async fn a_login_portrait_does_not_trigger_extra_profile_requests() {
    let server = HttpsServer::start(json!([reply(
        0,
        json!({"info":{
            "nick":"fixture","headurl":"https://thirdqq.qlogo.cn/g/current/100"
        }})
    )]));
    let session = account(&server.client, "qqmusic_uin=123; qqmusic_key=fixture")
        .await
        .unwrap();
    assert!(session.account.avatar_url.is_some());
    assert_eq!(server.calls().len(), 1);
}
