use super::*;
use tauri::webview::Cookie;

fn cookie(name: &str, value: &str, domain: &str) -> Cookie<'static> {
    Cookie::build((name.to_string(), value.to_string()))
        .domain(domain.to_string())
        .build()
}

#[test]
fn only_collects_current_platform_sessions_and_ignores_wrong_domains() {
    let cookies = vec![
        cookie("MUSIC_U", "fixture", ".music.163.com"),
        cookie("MUSIC_U", "evil", "music.163.com.evil.test"),
        cookie("__csrf", "csrf", ".music.163.com"),
        cookie("tracking", "unused", ".163.com"),
        cookie("qqmusic_key", "qqsecret", ".qq.com"),
        cookie("MUSIC_U", "parent", ".163.com"),
    ];
    assert_eq!(
        collect(Platform::Netease, cookies),
        "MUSIC_U=fixture; __csrf=csrf"
    );
    assert!(!safe_cookie_value("bad\r\nheader"));
    assert!(!safe_cookie_value("bad;header"));
    assert!(!cookie_domain(Platform::Qq, "evil.qq.com"));
}

#[test]
fn extracts_qq_music_identity_and_token_without_accepting_qq_only_login() {
    assert!(!has_session(Platform::Qq, "uin=o1234; skey=qqlogin"));
    assert!(has_session(
        Platform::Qq,
        "qqmusic_uin=1234; qm_keyst=musickey"
    ));
    let comm = qq_request_comm("uin=o1234; qqmusic_key=W_X_fixture");
    assert_eq!(comm["uin"], 1234);
    assert_eq!(comm["authst"], "W_X_fixture");
    assert_eq!(comm["tmeLoginType"], 1);
    assert_eq!(
        qq_user_id("qqmusic_uin=oops; uin=o00001234"),
        Some("1234".into())
    );
    assert!(qq_user_id("uin=0").is_none());
}

#[test]
fn login_navigation_requires_https_and_exact_platform_hosts() {
    for raw in [
        "https://music.163.com/#/my/",
        "https://reg.163.com/login",
        "https://dl.reg.163.com/",
    ] {
        assert!(login_navigation(
            Platform::Netease,
            &url::Url::parse(raw).unwrap()
        ));
    }
    for raw in [
        "https://y.qq.com/",
        "https://xui.ptlogin2.qq.com/",
        "https://open.weixin.qq.com/",
    ] {
        assert!(login_navigation(
            Platform::Qq,
            &url::Url::parse(raw).unwrap()
        ));
    }
    for raw in [
        "http://y.qq.com/",
        "https://y.qq.com.evil.test/",
        "https://y.qq.com:8443/",
        "https://user:pass@y.qq.com/",
        "file:///tmp/secret",
    ] {
        assert!(!login_navigation(
            Platform::Qq,
            &url::Url::parse(raw).unwrap()
        ));
    }
}
