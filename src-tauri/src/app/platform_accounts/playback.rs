mod kuwo;
mod netease;
mod qq;

use super::{model::*, PlatformAccountState};
use crate::app::error::{CommandError, CommandResult, ErrorCode};

pub(super) fn quality_ladder(quality: &str) -> CommandResult<&'static [&'static str]> {
    match quality {
        "128k" => Ok(&["128k"]),
        "320k" => Ok(&["320k", "128k"]),
        "flac" => Ok(&["flac", "320k", "128k"]),
        "flac24bit" => Ok(&["flac24bit", "flac", "320k", "128k"]),
        _ => Err(CommandError::invalid_argument("音质不正确")),
    }
}

pub(super) fn playback_url(platform: Platform, raw: &str) -> CommandResult<String> {
    if raw.len() > 8192 {
        return Err(invalid_response());
    }
    let mut url = url::Url::parse(raw).map_err(|_| invalid_response())?;
    let allowed = url.host_str().is_some_and(|host| {
        let roots: &[&str] = match platform {
            Platform::Netease => &["music.126.net", "music.163.com"],
            Platform::Qq => &["qqmusic.qq.com"],
            Platform::Kuwo => &["kuwo.cn"],
        };
        roots
            .iter()
            .any(|root| host == *root || host.ends_with(&format!(".{root}")))
    });
    if !allowed
        || !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.port_or_known_default(), Some(80 | 443))
    {
        return Err(invalid_response());
    }
    url.set_scheme("https").map_err(|_| invalid_response())?;
    Ok(url.to_string())
}

fn outcome(state: &str, message: Option<&str>) -> PlatformAccountPlayback {
    PlatformAccountPlayback {
        url: None,
        quality: None,
        state: state.into(),
        message: message.map(str::to_string),
    }
}

impl PlatformAccountState {
    pub(crate) async fn resolve_account_url(
        &self,
        platform: &str,
        id: &str,
        quality: &str,
        media_mid: Option<&str>,
        rejected: &[String],
    ) -> CommandResult<PlatformAccountPlayback> {
        let platform = Platform::parse(platform)?;
        quality_ladder(quality)?;
        if rejected.len() > 8 || rejected.iter().any(|url| url.len() > 8192) {
            return Err(CommandError::invalid_argument("播放恢复参数不正确"));
        }
        let (session, revision) = match self.session(platform).await {
            Ok(session) => session,
            Err(error) if error.code == ErrorCode::AuthRequired => {
                let expired = self
                    .0
                    .sessions
                    .lock()
                    .get(&platform)
                    .is_some_and(|session| session.account.state == "expired");
                return Ok(if expired {
                    outcome("expired", Some("音乐账号登录已失效，请到账号页重新登录"))
                } else {
                    outcome("not_connected", None)
                });
            }
            Err(error) => return Err(error),
        };
        let operation = async {
            match platform {
                Platform::Netease => {
                    netease::resolve(&self.0.client, &session, id, quality, rejected).await
                }
                Platform::Qq => {
                    qq::resolve(&self.0.client, &session, id, quality, media_mid, rejected).await
                }
                Platform::Kuwo => {
                    kuwo::resolve(&self.0.client, &session, id, quality, rejected).await
                }
            }
        };
        let result = tokio::time::timeout(std::time::Duration::from_secs(12), operation)
            .await
            .unwrap_or_else(|_| Err(CommandError::network("平台账号解析超时，请稍后重试")));
        self.check_revision(platform, revision)?;
        match result {
            Ok(Some((url, quality))) => Ok(PlatformAccountPlayback {
                url: Some(url),
                quality: Some(quality),
                state: "connected".into(),
                message: None,
            }),
            Ok(None) => Ok(outcome(
                "unavailable",
                Some("当前账号未获得可播放的完整歌曲，或这首歌已下架"),
            )),
            Err(error) if error.code == ErrorCode::AuthRequired => {
                self.expire(platform, revision, &error);
                Ok(outcome(
                    "expired",
                    Some("音乐账号登录已失效，请到账号页重新登录"),
                ))
            }
            Err(error) => Ok(outcome("unavailable", Some(&error.message))),
        }
    }
}

#[cfg(all(test, any(windows, target_os = "macos")))]
#[path = "__tests__/account_playback.rs"]
mod tests;
