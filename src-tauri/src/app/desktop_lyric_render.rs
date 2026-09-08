use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use super::error::{CommandError, CommandResult, ErrorCode};

#[cfg(all(test, windows))]
#[path = "__tests__/lyric_readiness.rs"]
mod tests;

#[derive(Default)]
pub(crate) struct DesktopLyricRenderState {
    ready: AtomicBool,
    ready_notify: tokio::sync::Notify,
}

#[tauri::command]
pub(crate) fn mark_desktop_lyric_ready(
    state: tauri::State<'_, DesktopLyricRenderState>,
) -> CommandResult<()> {
    state.ready.store(true, Ordering::Release);
    // notify_waiters wakes every pending waiter; notify_one would leave all
    // but one concurrent caller parked until their 2s timeout expired.
    state.ready_notify.notify_waiters();
    Ok(())
}

/// Waits until the desktop-lyric webview reports its first paint.
pub(crate) async fn wait_for_desktop_lyric_ready(
    state: &DesktopLyricRenderState,
) -> CommandResult<()> {
    if state.ready.load(Ordering::Acquire) {
        return Ok(());
    }
    let notified = state.ready_notify.notified();
    tokio::pin!(notified);
    // notify_waiters only reaches enabled futures, so enable the waiter before
    // re-checking the flag to close the store/notify race window.
    notified.as_mut().enable();
    if state.ready.load(Ordering::Acquire) {
        return Ok(());
    }
    tokio::time::timeout(Duration::from_secs(2), notified)
        .await
        .map_err(|_| CommandError::new(ErrorCode::Timeout, "桌面歌词页面初始化超时"))
}
