use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use super::error::{CommandError, CommandResult};

pub(crate) struct LocalServerState {
    pub(crate) port: u16,
    pub(crate) token: String,
}

/// Local API server connection info exposed to the renderer.
///
/// Mirrored by `LocalServerInfo` in `src/core/ipc/types.ts`.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalServerInfo {
    pub(crate) port: u16,
    pub(crate) token: String,
}

/// Application lifecycle state shared across the app.
///
/// Tracks whether the app is quitting (to prevent the desktop-lyric window
/// from closing prematurely) and holds a shutdown signal sender for
/// gracefully stopping the local HTTP server.
#[derive(Clone)]
pub(crate) struct AppLifecycleState {
    pub(crate) is_quitting: Arc<AtomicBool>,
    pub(crate) shutdown_tx: tokio::sync::watch::Sender<bool>,
}

/// First command the renderer issues, so it doubles as the startup readiness
/// signal consumed by `scripts/smoke-test.mjs`.
#[tauri::command]
pub(crate) fn get_local_server_info(state: State<'_, LocalServerState>) -> LocalServerInfo {
    super::smoke::record_frontend_ready(state.port);
    LocalServerInfo {
        port: state.port,
        token: state.token.clone(),
    }
}

/// Generates the per-launch local server auth token (64 hex chars).
///
/// The token only needs to be unpredictable to other local pages, so mixing
/// time, process/thread identity and stack address entropy through md5 is
/// sufficient; no extra RNG dependency is introduced and the value is never
/// persisted to disk.
pub(crate) fn generate_local_server_token() -> String {
    let stack_probe = 0u8;
    let seed = format!(
        "{:?}|{}|{:?}|{:p}",
        std::time::SystemTime::now(),
        std::process::id(),
        std::thread::current().id(),
        &stack_probe
    );
    let first = md5::compute(seed.as_bytes());
    let second = md5::compute([&first.0[..], seed.as_bytes()].concat());
    format!("{:x}{:x}", first, second)
}

/// Shows and focuses the main application window.
pub(crate) fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Initiates application shutdown.
///
/// Sets the quitting flag, sends the server shutdown signal, hides/closes
/// the desktop-lyric window, and exits the app.
pub(crate) fn quit_app_inner(app_handle: &tauri::AppHandle) {
    super::desktop_lyric_bounds::persist_visible_desktop_lyric_bounds(app_handle);

    if let Some(state) = app_handle.try_state::<AppLifecycleState>() {
        state.is_quitting.store(true, Ordering::SeqCst);
        let _ = state.shutdown_tx.send(true);
    }

    if let Some(lyric_window) = app_handle.get_webview_window("desktop-lyric") {
        let _ = lyric_window.hide();
        let _ = lyric_window.close();
    }

    app_handle.exit(0);
}

/// Tauri command to quit the application.
#[tauri::command]
pub(crate) fn quit_app(app_handle: tauri::AppHandle) -> CommandResult<()> {
    quit_app_inner(&app_handle);
    Ok(())
}
/// Payload for player control events relayed from the desktop-lyric window.
#[derive(Clone, serde::Serialize)]
struct PlayerControlPayload {
    action: String,
    value: Option<serde_json::Value>,
}

/// Relays player control commands from the desktop-lyric window to the main window.
///
/// The lyric window could emit to the main window directly (its capability
/// grants `core:event:allow-emit-to`), but routing through this command keeps
/// a single choke point in the main process for validation, throttling and
/// future extension.
#[tauri::command]
pub(crate) async fn relay_player_control(
    app_handle: tauri::AppHandle,
    action: String,
    value: Option<serde_json::Value>,
) -> CommandResult<()> {
    app_handle
        .emit_to(
            "main",
            "player-control",
            PlayerControlPayload { action, value },
        )
        .map_err(|error| {
            log::warn!("转发播放控制指令失败: {}", error);
            CommandError::window_unavailable("转发播放控制指令失败")
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_validation_rejects_non_https_schemes() {
        assert!(validate_external_url("https://tauri.app/").is_ok());
        assert!(validate_external_url("file:///C:/Windows/win.ini").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("http://example.com/").is_err());
    }

    #[test]
    fn local_server_token_is_long_hex() {
        let token = generate_local_server_token();
        assert!(token.len() >= 32);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn local_server_tokens_differ_between_generators() {
        // 线程 id 进入种子，因此不同线程必定得到不同令牌——本机其他页面
        // 无法通过"重放上一次的令牌"来预测。
        let other = std::thread::spawn(generate_local_server_token)
            .join()
            .unwrap();
        assert_ne!(generate_local_server_token(), other);
    }

    #[test]
    fn local_server_info_serializes_camel_case_for_the_renderer() {
        let info = LocalServerInfo {
            port: 51234,
            token: "abc123".to_string(),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["port"], 51234);
        assert_eq!(json["token"], "abc123");
    }
}

fn validate_external_url(raw_url: &str) -> CommandResult<String> {
    let parsed = url::Url::parse(raw_url)
        .map_err(|error| CommandError::invalid_argument(format!("无效 URL: {}", error)))?;
    if parsed.scheme() != "https" {
        return Err(CommandError::invalid_argument("仅允许打开 https 链接"));
    }
    if parsed.host_str().is_none() {
        return Err(CommandError::invalid_argument("URL 缺少 host"));
    }
    Ok(parsed.to_string())
}

/// Tauri command to open an external URL in the system's default browser.
///
/// Only HTTPS URLs are accepted. Local filesystem paths are handled by
/// `open_download_dir` so renderer input cannot select arbitrary files.
#[tauri::command]
pub(crate) async fn open_external_url(
    app_handle: tauri::AppHandle,
    url: String,
) -> CommandResult<()> {
    let url = validate_external_url(&url)?;
    app_handle
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|error| {
            log::warn!("打开外部链接失败: {}", error);
            CommandError::internal("打开外部链接失败")
        })
}
