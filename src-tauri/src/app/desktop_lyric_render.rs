use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Default)]
pub(crate) struct DesktopLyricRenderState {
    ready: AtomicBool,
    ready_notify: tokio::sync::Notify,
}

#[tauri::command]
pub(crate) fn mark_desktop_lyric_ready(state: tauri::State<'_, DesktopLyricRenderState>) {
    state.ready.store(true, Ordering::Release);
    state.ready_notify.notify_one();
}

pub(crate) async fn wait_for_desktop_lyric_ready(
    state: &DesktopLyricRenderState,
) -> Result<(), String> {
    let ready = state.ready_notify.notified();
    if state.ready.load(Ordering::Acquire) {
        return Ok(());
    }
    tokio::time::timeout(Duration::from_secs(2), ready)
        .await
        .map_err(|_| "桌面歌词页面初始化超时".to_string())
}
