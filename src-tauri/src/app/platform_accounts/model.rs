use serde::{Deserialize, Serialize};

use crate::app::error::{CommandError, CommandResult, ErrorCode};

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum Platform {
    Netease,
    Qq,
    Kuwo,
}

impl Platform {
    pub const ALL: [Self; 3] = [Self::Netease, Self::Qq, Self::Kuwo];

    pub fn index(self) -> usize {
        match self {
            Self::Netease => 0,
            Self::Qq => 1,
            Self::Kuwo => 2,
        }
    }

    pub fn parse(value: &str) -> CommandResult<Self> {
        match value {
            "netease" => Ok(Self::Netease),
            "qq" => Ok(Self::Qq),
            "kuwo" => Ok(Self::Kuwo),
            _ => Err(CommandError::new(
                ErrorCode::UnsupportedPlatform,
                "该平台暂不支持账号登录",
            )),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Netease => "netease",
            Self::Qq => "qq",
            Self::Kuwo => "kuwo",
        }
    }

    pub fn login_url(self) -> &'static str {
        match self {
            Self::Netease => "https://music.163.com/#/my/",
            Self::Qq => "https://y.qq.com/portal/profile.html",
            Self::Kuwo => "https://www.kuwo.cn/?login=open",
        }
    }

    pub fn window_label(self) -> String {
        format!("platform-login-{}", self.name())
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::Netease => "TuneFree · 网易云账号登录",
            Self::Qq => "TuneFree · QQ 音乐账号登录",
            Self::Kuwo => "TuneFree · 酷我音乐账号登录",
        }
    }
}

pub(super) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |value| value.as_millis() as u64)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAccount {
    pub platform: String,
    pub user_id: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    /// saved: restored from the vault, connected: verified this run, expired: rejected by platform.
    pub state: String,
    pub connected_at: u64,
}

// Session deliberately has no Debug implementation and is never an IPC result.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Session {
    pub account: PlatformAccount,
    pub cookie: String,
    pub encrypted_user_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLoginAttempt {
    pub platform: String,
    pub attempt_id: String,
    pub started_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLoginStatus {
    /// waiting / connected / closed / expired.
    pub state: String,
    pub account: Option<PlatformAccount>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPlaylist {
    pub id: String,
    pub name: String,
    pub cover_url: Option<String>,
    pub track_count: usize,
    pub kind: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPlaylistSong {
    pub id: String,
    pub source: String,
    pub name: String,
    pub artist: String,
    pub album: String,
    pub pic: Option<String>,
    pub lyric_id: Option<String>,
    pub str_media_mid: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPlaylistImport {
    pub name: String,
    pub songs: Vec<PlatformPlaylistSong>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPlaylistPreview {
    pub name: String,
    pub songs: Vec<PlatformPlaylistSong>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAccountPlayback {
    pub url: Option<String>,
    pub quality: Option<String>,
    pub state: String,
    pub message: Option<String>,
}

pub(super) const PREVIEW_PAGE_SIZE: usize = 20;
pub(super) fn preview_offset(page: usize) -> CommandResult<usize> {
    if !(1..=500).contains(&page) {
        return Err(CommandError::invalid_argument("歌曲页码不正确"));
    }
    Ok((page - 1) * PREVIEW_PAGE_SIZE)
}

pub(super) fn integer(value: &serde_json::Value) -> Option<usize> {
    value
        .as_u64()
        .and_then(|number| number.try_into().ok())
        .or_else(|| value.as_str()?.parse().ok())
}

pub(super) fn auth_required() -> CommandError {
    CommandError::new(ErrorCode::AuthRequired, "平台登录已失效，请重新登录")
}

pub(super) fn invalid_response() -> CommandError {
    CommandError::network("平台返回的数据不完整，请稍后重试")
}

pub(super) fn numeric_id(value: &str) -> CommandResult<&str> {
    if value.is_empty()
        || value.len() > 20
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || value.parse::<u64>().is_err()
    {
        return Err(CommandError::invalid_argument("平台 ID 格式不正确"));
    }
    Ok(value)
}

pub(super) fn value_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) if !text.trim().is_empty() => Some(text.clone()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

pub(super) fn image_url(value: &serde_json::Value) -> Option<String> {
    let raw = value.as_str()?;
    let normalized = if raw.starts_with("//") {
        format!("https:{raw}")
    } else {
        raw.to_string()
    };
    let mut url = url::Url::parse(&normalized).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let _ = url.set_scheme("https");
    Some(url.to_string())
}
