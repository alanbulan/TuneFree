use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use super::credentials::CredentialStore;
use super::{
    blocking, cookies, credentials, fetch_account, model::*, netease, qq, PlatformAccountState,
};
use crate::app::error::{CommandError, CommandResult, ErrorCode};

#[tauri::command]
pub async fn list_platform_accounts(
    state: State<'_, PlatformAccountState>,
) -> CommandResult<Vec<PlatformAccount>> {
    state.initialize().await?;
    let sessions = state.0.sessions.lock();
    Ok([Platform::Netease, Platform::Qq]
        .iter()
        .filter_map(|platform| {
            sessions
                .get(platform)
                .map(|session| session.account.clone())
        })
        .collect())
}

#[tauri::command]
pub async fn start_platform_login(
    app: AppHandle,
    state: State<'_, PlatformAccountState>,
    platform: String,
) -> CommandResult<PlatformLoginAttempt> {
    let platform = Platform::parse(&platform)?;
    if !credentials::platform_available() {
        return Err(CommandError::new(
            ErrorCode::CredentialUnavailable,
            "账号登录需要 macOS 或 Windows 桌面端的系统凭据存储",
        ));
    }
    state.initialize().await?;
    let _guard = state.0.operations.lock().await;
    if state.0.attempts.lock().contains_key(&platform) {
        return Err(CommandError::busy(
            "该平台已有登录窗口，请完成或取消当前登录",
        ));
    }
    if let Some(window) = app.get_webview_window(&platform.window_label()) {
        window.close()?;
    }
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| CommandError::internal("无法建立登录会话"))?;
    let url = platform
        .login_url()
        .parse()
        .map_err(|_| CommandError::internal("登录地址无效"))?;
    let window = WebviewWindowBuilder::new(
        &app,
        platform.window_label(),
        WebviewUrl::External(url),
    )
    .title(if platform == Platform::Netease {
        "TuneFree · 网易云账号登录"
    } else {
        "TuneFree · QQ 音乐账号登录"
    })
    .inner_size(920.0, 700.0)
    .min_inner_size(700.0, 540.0)
    .center()
    .incognito(true)
    .disable_drag_drop_handler()
    .on_navigation(move |url| cookies::login_navigation(platform, url))
    // Keep platform popup logins in this same isolated cookie store.
    .initialization_script(
        "window.open = function(url) { if (url) window.location.assign(url); return window; };",
    )
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build()?;
    state.invalidate(platform);
    let attempt = PlatformLoginAttempt {
        platform: platform.name().into(),
        attempt_id: bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
        started_at: now_ms(),
    };
    state.0.attempts.lock().insert(platform, attempt.clone());
    monitor_login_window(&app, state.inner(), platform, &window, &attempt);
    Ok(attempt)
}

fn monitor_login_window(
    app: &AppHandle,
    state: &PlatformAccountState,
    platform: Platform,
    window: &tauri::WebviewWindow,
    attempt: &PlatformLoginAttempt,
) {
    let watched_state = state.clone();
    let watched_id = attempt.attempt_id.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let watched_state = watched_state.clone();
            let watched_id = watched_id.clone();
            tauri::async_runtime::spawn(async move {
                // Serialize closing with the final vault transaction. If a
                // save already committed, its result remains a connected account.
                let _guard = watched_state.0.operations.lock().await;
                if watched_state.attempt(platform, &watched_id).is_ok() {
                    watched_state.invalidate(platform);
                }
            });
        }
    });
    let timeout_app = app.clone();
    let timeout_state = state.clone();
    let timeout_id = attempt.attempt_id.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(10 * 60)).await;
        let _guard = timeout_state.0.operations.lock().await;
        if timeout_state.attempt(platform, &timeout_id).is_ok() {
            timeout_state.invalidate(platform);
            if let Some(window) = timeout_app.get_webview_window(&platform.window_label()) {
                let _ = window.close();
            }
        }
    });
}

fn status(value: &str, account: Option<PlatformAccount>) -> PlatformLoginStatus {
    PlatformLoginStatus {
        state: value.into(),
        account,
    }
}

#[tauri::command]
pub async fn finish_platform_login(
    app: AppHandle,
    state: State<'_, PlatformAccountState>,
    platform: String,
    attempt_id: String,
) -> CommandResult<PlatformLoginStatus> {
    let platform = Platform::parse(&platform)?;
    let (attempt, revision) = {
        let _guard = state.0.operations.lock().await;
        (
            state.attempt(platform, &attempt_id)?,
            state.revision(platform),
        )
    };
    if now_ms().saturating_sub(attempt.started_at) > 10 * 60 * 1000 {
        let _guard = state.0.operations.lock().await;
        cancel_attempt(&app, &state, platform, &attempt_id)?;
        return Ok(status("expired", None));
    }
    let Some(window) = app.get_webview_window(&platform.window_label()) else {
        let _guard = state.0.operations.lock().await;
        cancel_attempt(&app, &state, platform, &attempt_id)?;
        return Ok(status("closed", None));
    };
    let cookies = blocking(move || {
        window
            .cookies()
            .map_err(|_| CommandError::window_unavailable("读取平台登录状态失败，请重试"))
    })
    .await?;
    state.check_revision(platform, revision)?;
    let cookie = cookies::collect(platform, cookies);
    if !cookies::has_session(platform, &cookie) {
        return Ok(status("waiting", None));
    }
    if !credentials::supported() {
        return Err(CommandError::new(
            ErrorCode::CredentialUnavailable,
            "当前测试环境未启用账号凭据存储",
        ));
    }
    let mut session = fetch_account(&state.0.client, platform, &cookie).await?;
    state.check_revision(platform, revision)?;
    state.attempt(platform, &attempt_id)?;
    let _guard = state.0.operations.lock().await;
    state.check_revision(platform, revision)?;
    state.attempt(platform, &attempt_id)?;
    let to_save = session.clone();
    blocking(move || {
        credentials::save_verified(&credentials::SystemCredentials, platform, &to_save)
    })
    .await?;
    state.check_revision(platform, revision)?;
    session.account.state = "connected".into();
    let account = session.account.clone();
    state.0.sessions.lock().insert(platform, session);
    state.0.attempts.lock().remove(&platform);
    if let Some(window) = app.get_webview_window(&platform.window_label()) {
        // The vault transaction already committed. A window-close failure
        // must not report an unsuccessful login after saving the session.
        if window.close().is_err() {
            log::warn!("平台登录已完成，临时窗口未能自动关闭");
        }
    }
    Ok(status("connected", Some(account)))
}

fn cancel_attempt(
    app: &AppHandle,
    state: &PlatformAccountState,
    platform: Platform,
    id: &str,
) -> CommandResult<()> {
    state.attempt(platform, id)?;
    state.invalidate(platform);
    if let Some(window) = app.get_webview_window(&platform.window_label()) {
        window.close()?;
    }
    state.0.attempts.lock().remove(&platform);
    Ok(())
}

#[tauri::command]
pub async fn cancel_platform_login(
    app: AppHandle,
    state: State<'_, PlatformAccountState>,
    platform: String,
    attempt_id: String,
) -> CommandResult<()> {
    let _guard = state.0.operations.lock().await;
    cancel_attempt(&app, &state, Platform::parse(&platform)?, &attempt_id)
}

#[tauri::command]
pub async fn refresh_platform_account(
    state: State<'_, PlatformAccountState>,
    platform: String,
) -> CommandResult<PlatformAccount> {
    let platform = Platform::parse(&platform)?;
    let (previous, revision) = state.session(platform).await?;
    let fetched = fetch_account(&state.0.client, platform, &previous.cookie).await;
    let mut session = match fetched {
        Ok(session) => session,
        Err(error) => {
            state.expire(platform, revision, &error);
            return Err(error);
        }
    };
    let _guard = state.0.operations.lock().await;
    state.check_revision(platform, revision)?;
    session.account.connected_at = previous.account.connected_at;
    let account = session.account.clone();
    state.0.sessions.lock().insert(platform, session);
    Ok(account)
}

#[tauri::command]
pub async fn logout_platform_account(
    app: AppHandle,
    state: State<'_, PlatformAccountState>,
    platform: String,
) -> CommandResult<()> {
    let platform = Platform::parse(&platform)?;
    let _guard = state.0.operations.lock().await;
    state.invalidate(platform);
    state.0.attempts.lock().remove(&platform);
    if let Some(window) = app.get_webview_window(&platform.window_label()) {
        window.close()?;
    }
    blocking(move || credentials::SystemCredentials.delete(platform)).await?;
    state.0.sessions.lock().remove(&platform);
    Ok(())
}

#[tauri::command]
pub async fn list_platform_playlists(
    state: State<'_, PlatformAccountState>,
    platform: String,
) -> CommandResult<Vec<PlatformPlaylist>> {
    let platform = Platform::parse(&platform)?;
    let (session, revision) = state.session(platform).await?;
    let result = match platform {
        Platform::Netease => netease::playlists(&state.0.client, &session).await,
        Platform::Qq => qq::playlists(&state.0.client, &session).await,
    };
    state.check_revision(platform, revision)?;
    if let Err(error) = &result {
        state.expire(platform, revision, error);
    }
    result
}

#[tauri::command]
pub async fn import_platform_playlist(
    state: State<'_, PlatformAccountState>,
    platform: String,
    playlist_id: String,
) -> CommandResult<PlatformPlaylistImport> {
    let platform = Platform::parse(&platform)?;
    let (session, revision) = state.session(platform).await?;
    let result = match platform {
        Platform::Netease => netease::import(&state.0.client, &session, &playlist_id).await,
        Platform::Qq => qq::import(&state.0.client, &session, &playlist_id).await,
    };
    state.check_revision(platform, revision)?;
    if let Err(error) = &result {
        state.expire(platform, revision, error);
    }
    result
}
