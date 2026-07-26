use tauri::{Emitter, Manager, Runtime};

use super::desktop_lyric_bounds::persist_desktop_lyric_webview_bounds;
use super::desktop_lyric_render::{wait_for_desktop_lyric_ready, DesktopLyricRenderState};
use super::error::{CommandError, CommandResult};

/// Logs the underlying window error and returns a summary for the renderer.
fn lyric_window_error(message: &str, error: impl std::fmt::Display) -> CommandError {
    log::warn!("{}: {}", message, error);
    CommandError::window_unavailable(message)
}

fn apply_desktop_lyric_lock<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    lock: bool,
) -> CommandResult<()> {
    window
        .set_focusable(!lock)
        .map_err(|error| lyric_window_error("设置桌面歌词焦点状态失败", error))?;
    window
        .set_ignore_cursor_events(lock)
        .map_err(|error| lyric_window_error("设置桌面歌词锁定状态失败", error))?;
    window
        .emit_to("desktop-lyric", "lock-change", lock)
        .map_err(|error| lyric_window_error("同步桌面歌词锁定状态失败", error))
}

#[tauri::command]
pub(crate) async fn show_desktop_lyric_window(
    app_handle: tauri::AppHandle,
    lock: bool,
) -> CommandResult<()> {
    let lyric_window = app_handle
        .get_webview_window("desktop-lyric")
        .ok_or_else(|| CommandError::window_unavailable("找不到桌面歌词窗口"))?;

    let render_state = app_handle.state::<DesktopLyricRenderState>();
    wait_for_desktop_lyric_ready(&render_state).await?;
    apply_desktop_lyric_lock(&lyric_window, lock)?;
    lyric_window
        .show()
        .map_err(|error| lyric_window_error("显示桌面歌词失败", error))?;

    Ok(())
}

#[tauri::command]
pub(crate) fn set_desktop_lyric_lock(
    app_handle: tauri::AppHandle,
    lock: bool,
) -> CommandResult<()> {
    let lyric_window = app_handle
        .get_webview_window("desktop-lyric")
        .ok_or_else(|| CommandError::window_unavailable("找不到桌面歌词窗口"))?;
    apply_desktop_lyric_lock(&lyric_window, lock)
}

#[tauri::command]
pub(crate) async fn hide_desktop_lyric_window(app_handle: tauri::AppHandle) -> CommandResult<()> {
    let lyric_window = app_handle
        .get_webview_window("desktop-lyric")
        .ok_or_else(|| CommandError::window_unavailable("找不到桌面歌词窗口"))?;

    persist_desktop_lyric_webview_bounds(&lyric_window)
        .await
        .map_err(|error| {
            log::warn!("{}", error);
            CommandError::io("保存桌面歌词窗口位置失败")
        })?;

    lyric_window
        .hide()
        .map_err(|error| lyric_window_error("隐藏桌面歌词失败", error))?;
    Ok(())
}
