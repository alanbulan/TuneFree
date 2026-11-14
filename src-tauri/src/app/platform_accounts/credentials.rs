use super::model::{Platform, Session};
use crate::app::error::{CommandError, CommandResult, ErrorCode};

pub(super) trait CredentialStore {
    fn load(&self, platform: Platform) -> CommandResult<Option<String>>;
    fn save(&self, platform: Platform, value: &str) -> CommandResult<()>;
    fn delete(&self, platform: Platform) -> CommandResult<()>;
}

pub(super) struct SystemCredentials;

pub(super) fn platform_available() -> bool {
    cfg!(any(windows, target_os = "macos"))
}

pub(super) fn supported() -> bool {
    platform_available() && !crate::app::is_smoke_test()
}

fn unavailable() -> CommandError {
    CommandError::new(
        ErrorCode::CredentialUnavailable,
        "当前环境无法使用系统凭据存储",
    )
}

#[cfg(any(windows, target_os = "macos"))]
fn entry(platform: Platform) -> CommandResult<keyring::Entry> {
    let service = "com.alanbulan.tunefree.platform-accounts";
    #[cfg(test)]
    let service = format!("{service}.tests-{}", std::process::id());
    #[cfg(test)]
    let service = service.as_str();
    let account = format!("{}-session-v1", platform.name());
    keyring::Entry::new(service, &account).map_err(|_| unavailable())
}

#[cfg(any(windows, target_os = "macos"))]
impl CredentialStore for SystemCredentials {
    fn load(&self, platform: Platform) -> CommandResult<Option<String>> {
        if !supported() {
            return Ok(None);
        }
        match entry(platform)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(CommandError::new(
                ErrorCode::CredentialUnavailable,
                "读取登录会话失败，请检查系统凭据权限",
            )),
        }
    }

    fn save(&self, platform: Platform, value: &str) -> CommandResult<()> {
        if !supported() {
            return Err(unavailable());
        }
        entry(platform)?.set_password(value).map_err(|_| {
            CommandError::new(
                ErrorCode::CredentialUnavailable,
                "保存登录会话失败，请检查系统凭据权限",
            )
        })
    }

    fn delete(&self, platform: Platform) -> CommandResult<()> {
        if !supported() {
            return Err(unavailable());
        }
        match entry(platform)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(CommandError::new(
                ErrorCode::CredentialUnavailable,
                "清除登录会话失败，请检查系统凭据权限",
            )),
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
impl CredentialStore for SystemCredentials {
    fn load(&self, _platform: Platform) -> CommandResult<Option<String>> {
        Ok(None)
    }
    fn save(&self, _platform: Platform, _value: &str) -> CommandResult<()> {
        Err(unavailable())
    }
    fn delete(&self, _platform: Platform) -> CommandResult<()> {
        Err(unavailable())
    }
}

pub(super) fn save_verified(
    store: &impl CredentialStore,
    platform: Platform,
    session: &Session,
) -> CommandResult<()> {
    let raw = serde_json::to_string(session)?;
    let previous = store.load(platform)?;
    let result = store.save(platform, &raw).and_then(|()| {
        if store.load(platform)?.as_deref() == Some(raw.as_str()) {
            Ok(())
        } else {
            Err(CommandError::new(
                ErrorCode::CredentialUnavailable,
                "系统凭据保存校验失败",
            ))
        }
    });
    if result.is_err() {
        let rollback = match previous {
            Some(value) => store.save(platform, &value),
            None => store.delete(platform),
        };
        if rollback.is_err() {
            return Err(CommandError::new(
                ErrorCode::CredentialUnavailable,
                "系统凭据保存与恢复失败，请退出登录后重试",
            ));
        }
    }
    result
}

#[cfg(test)]
#[path = "__tests__/credentials.rs"]
mod tests;
