mod commands;
mod cookies;
mod credentials;
mod http;
mod model;
mod netease;
mod qq;

use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};

use crate::app::error::{CommandError, CommandResult};
use credentials::{CredentialStore, SystemCredentials};
use model::{Platform, PlatformLoginAttempt, Session};

pub(super) use commands::*;
pub(crate) use cookies::qq_request_comm;

struct Inner {
    initialized: AtomicBool,
    sessions: Mutex<HashMap<Platform, Session>>,
    attempts: Mutex<HashMap<Platform, PlatformLoginAttempt>>,
    operations: tokio::sync::Mutex<()>,
    revisions: [AtomicU64; 2],
    client: reqwest::Client,
}

#[derive(Clone)]
pub(crate) struct PlatformAccountState(Arc<Inner>);

impl Default for PlatformAccountState {
    fn default() -> Self {
        Self(Arc::new(Inner {
            initialized: AtomicBool::new(false),
            sessions: Mutex::new(HashMap::new()),
            attempts: Mutex::new(HashMap::new()),
            operations: tokio::sync::Mutex::new(()),
            revisions: [AtomicU64::new(0), AtomicU64::new(0)],
            client: http::client(),
        }))
    }
}

impl PlatformAccountState {
    fn revision(&self, platform: Platform) -> u64 {
        self.0.revisions[usize::from(platform == Platform::Qq)].load(Ordering::SeqCst)
    }

    fn invalidate(&self, platform: Platform) {
        self.0.revisions[usize::from(platform == Platform::Qq)].fetch_add(1, Ordering::SeqCst);
    }

    fn check_revision(&self, platform: Platform, revision: u64) -> CommandResult<()> {
        if self.revision(platform) == revision {
            Ok(())
        } else {
            Err(CommandError::cancelled("账号操作已取消"))
        }
    }

    async fn initialize(&self) -> CommandResult<()> {
        if self.0.initialized.load(Ordering::Acquire) {
            return Ok(());
        }
        let _guard = self.0.operations.lock().await;
        if self.0.initialized.load(Ordering::Acquire) {
            return Ok(());
        }
        let loaded = blocking(|| {
            let mut sessions = HashMap::new();
            for platform in [Platform::Netease, Platform::Qq] {
                if let Some(raw) = SystemCredentials.load(platform)? {
                    let mut session: Session = serde_json::from_str(&raw).map_err(|_| {
                        CommandError::internal("已保存的登录会话损坏，请退出登录后重试")
                    })?;
                    if !cookies::valid_stored_session(platform, &session) {
                        return Err(CommandError::internal(
                            "已保存的登录会话无效，请退出登录后重试",
                        ));
                    }
                    session.account.state = "saved".into();
                    sessions.insert(platform, session);
                }
            }
            Ok(sessions)
        })
        .await?;
        *self.0.sessions.lock() = loaded;
        self.0.initialized.store(true, Ordering::Release);
        Ok(())
    }

    async fn session(&self, platform: Platform) -> CommandResult<(Session, u64)> {
        self.initialize().await?;
        // Snapshot only after a login/logout vault transaction has finished.
        // Otherwise a read during deletion could pair the old cookie with
        // the new revision and survive the logout's invalidation.
        let _guard = self.0.operations.lock().await;
        let revision = self.revision(platform);
        let session = self
            .0
            .sessions
            .lock()
            .get(&platform)
            .filter(|session| session.account.state != "expired")
            .cloned()
            .ok_or_else(model::auth_required)?;
        Ok((session, revision))
    }

    fn expire(&self, platform: Platform, revision: u64, error: &CommandError) {
        let mut sessions = self.0.sessions.lock();
        if error.code == crate::app::error::ErrorCode::AuthRequired
            && self.revision(platform) == revision
        {
            if let Some(session) = sessions.get_mut(&platform) {
                session.account.state = "expired".into();
            }
        }
    }

    fn attempt(&self, platform: Platform, id: &str) -> CommandResult<PlatformLoginAttempt> {
        self.0
            .attempts
            .lock()
            .get(&platform)
            .filter(|attempt| attempt.attempt_id == id)
            .cloned()
            .ok_or_else(|| CommandError::cancelled("这次登录已经结束，请重新连接"))
    }

    pub(crate) async fn playback_cookie(&self, platform: &str) -> Option<String> {
        let platform = Platform::parse(if platform == "tencent" {
            "qq"
        } else {
            platform
        })
        .ok()?;
        self.session(platform)
            .await
            .ok()
            .map(|(session, _)| session.cookie)
    }

    pub(crate) fn http_client(&self) -> &reqwest::Client {
        &self.0.client
    }
}

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| CommandError::internal("账号操作执行失败"))?
}

async fn fetch_account(
    client: &reqwest::Client,
    platform: Platform,
    cookie: &str,
) -> CommandResult<Session> {
    match platform {
        Platform::Netease => netease::account(client, cookie).await,
        Platform::Qq => qq::account(client, cookie).await,
    }
}

#[cfg(test)]
#[path = "__tests__/state.rs"]
mod tests;

#[cfg(all(test, any(windows, target_os = "macos")))]
#[path = "__tests__/pagination_http.rs"]
mod pagination_http_tests;

#[cfg(all(test, any(windows, target_os = "macos")))]
#[path = "__tests__/playback_http.rs"]
mod playback_http_tests;
