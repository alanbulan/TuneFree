mod commands;
mod cookies;
mod credentials;
mod http;
mod kuwo;
mod login_window;
mod model;
mod netease;
mod playback;
mod preview;
mod profiles;
mod qq;
mod qq_sign;

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
    revisions: [AtomicU64; 3],
    profile_repairs: [AtomicBool; 3],
    app: Mutex<Option<tauri::AppHandle>>,
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
            revisions: [AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0)],
            profile_repairs: [
                AtomicBool::new(false),
                AtomicBool::new(false),
                AtomicBool::new(false),
            ],
            app: Mutex::new(None),
            client: http::client(),
        }))
    }
}

impl PlatformAccountState {
    fn revision(&self, platform: Platform) -> u64 {
        self.0.revisions[platform.index()].load(Ordering::SeqCst)
    }

    fn invalidate(&self, platform: Platform) {
        self.0.revisions[platform.index()].fetch_add(1, Ordering::SeqCst);
        self.notify_account_changed(platform);
    }

    fn notify_account_changed(&self, platform: Platform) {
        if let Some(app) = self.0.app.lock().as_ref() {
            use tauri::Emitter;
            let _ = app.emit_to(
                "main",
                "platform-account-changed",
                serde_json::json!({"platform": platform.name()}),
            );
        }
    }

    pub(crate) fn attach_app(&self, app: tauri::AppHandle) {
        *self.0.app.lock() = Some(app);
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
            let values = SystemCredentials.load_all()?;
            let mut sessions = HashMap::new();
            for platform in Platform::ALL {
                if let Some(raw) = values.get(&platform) {
                    let mut session: Session = serde_json::from_str(raw).map_err(|_| {
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

    async fn retry_initialization(&self) -> CommandResult<()> {
        #[cfg(target_os = "macos")]
        {
            // Only this explicit UI command re-enables a denied request.
            let _guard = self.0.operations.lock().await;
            crate::credentials::retry_failed_access();
        }
        self.initialize().await
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
            if let Some(session) = sessions
                .get_mut(&platform)
                .filter(|session| session.account.state != "expired")
            {
                session.account.state = "expired".into();
                self.invalidate(platform);
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
        Platform::Kuwo => kuwo::account(client, cookie).await,
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
