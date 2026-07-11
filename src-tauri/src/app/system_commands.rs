use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager, State};

pub(crate) struct LocalServerState {
    pub(crate) port: u16,
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

#[tauri::command]
pub(crate) fn get_local_server_port(state: State<'_, LocalServerState>) -> u16 {
    state.port
}

pub(crate) fn acquire_process_instance() -> Option<single_instance::SingleInstance> {
    let instance = match single_instance::SingleInstance::new("com.alanbulan.tunefree.desktop") {
        Ok(instance) => instance,
        Err(e) => {
            eprintln!("failed to initialize single-instance guard: {}", e);
            return None;
        }
    };

    if instance.is_single() {
        Some(instance)
    } else {
        None
    }
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
pub(crate) fn quit_app(app_handle: tauri::AppHandle) {
    quit_app_inner(&app_handle);
}
/// Payload for player control events relayed from the desktop-lyric window.
#[derive(Clone, serde::Serialize)]
struct PlayerControlPayload {
    action: String,
    value: Option<serde_json::Value>,
}

/// Relays player control commands from the desktop-lyric window to the main window.
///
/// The desktop-lyric window calls this via `invoke` (which doesn't require
/// event emission permissions), and the Rust side emits the event to the
/// main window using `emit_to` (which bypasses capability restrictions).
#[tauri::command]
pub(crate) async fn relay_player_control(
    app_handle: tauri::AppHandle,
    action: String,
    value: Option<serde_json::Value>,
) -> Result<(), String> {
    app_handle
        .emit_to(
            "main",
            "player-control",
            PlayerControlPayload { action, value },
        )
        .map_err(|e| format!("Failed to relay player control: {}", e))?;
    Ok(())
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
}

fn validate_external_url(raw_url: &str) -> Result<String, String> {
    let parsed = url::Url::parse(raw_url).map_err(|e| format!("无效 URL: {}", e))?;
    if parsed.scheme() != "https" {
        return Err("仅允许打开 https 链接".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("URL 缺少 host".to_string());
    }
    Ok(parsed.to_string())
}

/// Tauri command to open an external URL in the system's default browser.
///
/// Only HTTPS URLs are accepted. Local filesystem paths are handled by
/// `open_download_dir` so renderer input cannot select arbitrary files.
#[tauri::command]
pub(crate) async fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
