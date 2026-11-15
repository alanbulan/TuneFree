use tauri::{AppHandle, Manager, State};

use super::credentials::CredentialStore;
use super::{
    blocking, cookies, credentials, fetch_account, kuwo, login_window, model::*, netease, preview,
    qq, PlatformAccountState,
};
use crate::app::error::{CommandError, CommandResult, ErrorCode};

#[tauri::command]
pub async fn list_platform_accounts(
    state: State<'_, PlatformAccountState>,
) -> CommandResult<Vec<PlatformAccount>> {
    state.initialize().await?;
    state.repair_saved_profiles().await;
    let sessions = state.0.sessions.lock();
    Ok(Platform::ALL
        .iter()
        .filter_map(|platform| {
            sessions
                .get(platform)
                .map(|session| session.account.clone())
        })
        .collect())
}

#[tauri::command]
pub async fn retry_platform_account_access(
    state: State<'_, PlatformAccountState>,
) -> CommandResult<Vec<PlatformAccount>> {
    state.retry_initialization().await?;
    list_platform_accounts(state).await
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
    login_window::close(&app, platform)?;
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| CommandError::internal("无法建立登录会话"))?;
    let window = login_window::open(&app, platform)?;
    state.invalidate(platform);
    let attempt = PlatformLoginAttempt {
        platform: platform.name().into(),
        attempt_id: bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
        started_at: now_ms(),
    };
    state.0.attempts.lock().insert(platform, attempt.clone());
    login_window::monitor(&app, state.inner(), platform, &window, &attempt);
    Ok(attempt)
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
    state.invalidate(platform);
    if login_window::close(&app, platform).is_err() {
        log::warn!("平台登录已完成，临时窗口未能自动关闭");
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
    login_window::close(app, platform)?;
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
    state
        .refresh_profile(platform, previous, revision, credentials::SystemCredentials)
        .await
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
    login_window::close(&app, platform)?;
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
        Platform::Kuwo => {
            async {
                kuwo::account(&state.0.client, &session.cookie).await?;
                kuwo::playlists(&state.0.client, &session).await
            }
            .await
        }
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
        Platform::Kuwo => {
            async {
                kuwo::account(&state.0.client, &session.cookie).await?;
                kuwo::import(&state.0.client, &session, &playlist_id).await
            }
            .await
        }
    };
    state.check_revision(platform, revision)?;
    if let Err(error) = &result {
        state.expire(platform, revision, error);
    }
    result
}

#[tauri::command]
pub async fn preview_platform_playlist(
    state: State<'_, PlatformAccountState>,
    platform: String,
    playlist_id: String,
    page: usize,
) -> CommandResult<PlatformPlaylistPreview> {
    let platform = Platform::parse(&platform)?;
    let (session, revision) = state.session(platform).await?;
    let result = match platform {
        Platform::Netease => preview::netease(&state.0.client, &session, &playlist_id, page).await,
        Platform::Qq => preview::qq(&state.0.client, &session, &playlist_id, page).await,
        Platform::Kuwo => {
            async {
                kuwo::account(&state.0.client, &session.cookie).await?;
                kuwo::preview(&state.0.client, &session, &playlist_id, page).await
            }
            .await
        }
    };
    state.check_revision(platform, revision)?;
    if let Err(error) = &result {
        state.expire(platform, revision, error);
    }
    result
}

#[tauri::command]
pub async fn resolve_platform_account_url(
    state: State<'_, PlatformAccountState>,
    platform: String,
    song_id: String,
    quality: String,
    media_mid: Option<String>,
    rejected_urls: Option<Vec<String>>,
) -> CommandResult<PlatformAccountPlayback> {
    state
        .resolve_account_url(
            &platform,
            &song_id,
            &quality,
            media_mid.as_deref(),
            &rejected_urls.unwrap_or_default(),
        )
        .await
}
