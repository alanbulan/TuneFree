use super::model::{Platform, Session};

const NETEASE_NAMES: &[&str] = &["MUSIC_U", "__csrf", "NMTID", "MUSIC_A"];
const QQ_NAMES: &[&str] = &[
    "uin",
    "p_uin",
    "qqmusic_uin",
    "musicid",
    "skey",
    "p_skey",
    "qqmusic_key",
    "qm_keyst",
    "wxuin",
    "wxunionid",
    "login_type",
    "tmeLoginType",
    "psrf_qqopenid",
    "psrf_qqunionid",
    "psrf_qqaccess_token",
    "psrf_qqrefresh_token",
    "psrf_musickey_createtime",
    "psrf_access_token_expiresAt",
];

pub(super) fn value<'a>(header: &'a str, name: &str) -> Option<&'a str> {
    header
        .split(';')
        .filter_map(|pair| pair.trim().split_once('='))
        .find_map(|(key, value)| (key == name && !value.is_empty()).then_some(value))
}

pub(super) fn safe_cookie_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 4096
        && value
            .bytes()
            .all(|byte| (0x21..=0x7e).contains(&byte) && byte != b';')
}

pub(super) fn cookie_domain(platform: Platform, domain: &str) -> bool {
    let domain = domain.trim_start_matches('.').to_ascii_lowercase();
    match platform {
        Platform::Netease => matches!(domain.as_str(), "music.163.com" | "163.com"),
        Platform::Qq => matches!(
            domain.as_str(),
            "qq.com" | "y.qq.com" | "music.qq.com" | "u.y.qq.com"
        ),
    }
}

pub(super) fn collect(platform: Platform, cookies: Vec<tauri::webview::Cookie<'static>>) -> String {
    let names = match platform {
        Platform::Netease => NETEASE_NAMES,
        Platform::Qq => QQ_NAMES,
    };
    // More specific platform cookies win over parent-domain cookies of the same name.
    let mut cookies = cookies;
    cookies.sort_by_key(|cookie| std::cmp::Reverse(cookie.domain().unwrap_or_default().len()));
    let mut values = std::collections::BTreeMap::new();
    for cookie in cookies {
        let expired = cookie.expires_datetime().is_some_and(|expiry| {
            expiry.unix_timestamp() <= (super::model::now_ms() / 1000) as i64
        });
        if names.contains(&cookie.name())
            && cookie_domain(platform, cookie.domain().unwrap_or_default())
            && safe_cookie_value(cookie.value())
            && !expired
        {
            values
                .entry(cookie.name().to_string())
                .or_insert_with(|| cookie.value().to_string());
        }
    }
    values
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

pub(super) fn has_session(platform: Platform, cookie: &str) -> bool {
    match platform {
        Platform::Netease => value(cookie, "MUSIC_U").is_some(),
        Platform::Qq => qq_user_id(cookie).is_some() && qq_key(cookie).is_some(),
    }
}

pub(super) fn qq_user_id(cookie: &str) -> Option<String> {
    ["qqmusic_uin", "musicid", "wxuin", "uin", "p_uin"]
        .into_iter()
        .find_map(|name| {
            let id = value(cookie, name)?.trim_start_matches('o');
            let number = id.parse::<u64>().ok()?;
            (number > 0).then(|| number.to_string())
        })
}

pub(super) fn qq_key(cookie: &str) -> Option<&str> {
    value(cookie, "qqmusic_key").or_else(|| value(cookie, "qm_keyst"))
}

pub(crate) fn qq_request_comm(cookie: &str) -> serde_json::Value {
    let key = qq_key(cookie).unwrap_or_default();
    let token = key.bytes().fold(5381_u32, |hash, byte| {
        hash.wrapping_mul(33).wrapping_add(u32::from(byte))
    }) & 0x7fff_ffff;
    let login_type = value(cookie, "login_type")
        .or_else(|| value(cookie, "tmeLoginType"))
        .and_then(|raw| raw.parse::<u32>().ok())
        .unwrap_or(if key.starts_with("W_X") { 1 } else { 2 });
    serde_json::json!({
        "ct": 24, "cv": 0, "format": "json", "uin": qq_user_id(cookie).and_then(|id| id.parse::<u64>().ok()).unwrap_or(0),
        "authst": key, "tmeLoginType": login_type, "g_tk": token, "g_tk_new_20200303": token,
    })
}

pub(super) fn valid_stored_session(platform: Platform, session: &Session) -> bool {
    session.account.platform == platform.name()
        && !session.account.user_id.is_empty()
        && session.cookie.len() < 16_384
        && has_session(platform, &session.cookie)
        && session.cookie.split(';').all(|part| {
            part.trim().split_once('=').is_some_and(|(name, value)| {
                let names = match platform {
                    Platform::Netease => NETEASE_NAMES,
                    Platform::Qq => QQ_NAMES,
                };
                names.contains(&name) && safe_cookie_value(value)
            })
        })
}

pub(super) fn login_navigation(platform: Platform, url: &url::Url) -> bool {
    let hosts: &[&str] = match platform {
        Platform::Netease => &[
            "music.163.com",
            "y.music.163.com",
            "st.music.163.com",
            "reg.163.com",
            "dl.reg.163.com",
            "passport.163.com",
            "c.dun.163.com",
        ],
        Platform::Qq => &[
            "y.qq.com",
            "graph.qq.com",
            "xui.ptlogin2.qq.com",
            "ui.ptlogin2.qq.com",
            "ssl.ptlogin2.qq.com",
            "ptlogin2.qq.com",
            "login.music.qq.com",
            "open.weixin.qq.com",
        ],
    };
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| hosts.contains(&host))
}

#[cfg(test)]
#[path = "__tests__/cookies.rs"]
mod tests;
