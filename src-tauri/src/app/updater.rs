use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;

use super::error::{CommandError, CommandResult, ErrorCode};

#[cfg(all(test, windows))]
#[path = "__tests__/updater_http.rs"]
mod integration_tests;

/// Progress payload emitted during update downloads.
///
/// Emitted via the `update-progress` event.
#[derive(Clone, serde::Serialize)]
pub(crate) struct UpdateProgress {
    progress: u8,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}

/// Logs the upstream updater error and returns a summary the renderer can show.
fn update_error(message: &str, error: impl std::fmt::Display) -> CommandError {
    log::warn!("{}: {}", message, error);
    CommandError::new(ErrorCode::UpdateFailed, message)
}

#[tauri::command]
pub(crate) async fn check_for_update(
    app_handle: tauri::AppHandle,
) -> CommandResult<Option<AvailableUpdate>> {
    if super::smoke::is_enabled() {
        return Ok(None);
    }
    let update = app_handle
        .updater()
        .map_err(|error| update_error("初始化更新器失败", error))?
        .check()
        .await
        .map_err(|error| update_error("检查更新失败", error))?;

    Ok(update.map(|update| AvailableUpdate {
        version: update.version,
        notes: update.body,
    }))
}

fn calculate_update_progress(downloaded: u64, total: Option<u64>) -> u8 {
    total
        .filter(|total| *total > 0)
        .map(|total| ((downloaded.saturating_mul(100) / total).min(99)) as u8)
        .unwrap_or(0)
}

/// Downloads, verifies and installs the update selected by the official
/// Tauri updater for the current platform and CPU architecture.
#[tauri::command]
pub(crate) async fn download_and_install_update(app_handle: tauri::AppHandle) -> CommandResult<()> {
    if super::smoke::is_enabled() {
        return Err(CommandError::cancelled("冒烟测试不执行自动更新"));
    }
    let update = app_handle
        .updater()
        .map_err(|error| update_error("初始化更新器失败", error))?
        .check()
        .await
        .map_err(|error| update_error("检查更新失败", error))?
        .ok_or_else(|| CommandError::not_found("当前没有可安装的更新"))?;

    let progress_handle = app_handle.clone();
    let mut downloaded = 0_u64;
    let _ = app_handle.emit("update-progress", UpdateProgress { progress: 0 });

    let bytes = update
        .download(
            move |chunk_length, content_length| {
                downloaded = downloaded.saturating_add(chunk_length as u64);
                let progress = calculate_update_progress(downloaded, content_length);
                let _ = progress_handle.emit("update-progress", UpdateProgress { progress });
            },
            || {},
        )
        .await
        .map_err(|error| update_error("下载或安装更新失败", error))?;

    // download 返回时官方更新器已完成签名校验。
    let _ = app_handle.emit("update-progress", UpdateProgress { progress: 100 });
    let installed = update
        .install(bytes)
        .map_err(|error| update_error("下载或安装更新失败", error));
    // Windows 安装器由官方插件启动，并负责退出、安装后重启。
    #[cfg(windows)]
    {
        installed
    }
    #[cfg(not(windows))]
    {
        installed?;
        app_handle.restart()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_progress_is_bounded_until_signature_verification_finishes() {
        assert_eq!(calculate_update_progress(0, Some(100)), 0);
        assert_eq!(calculate_update_progress(50, Some(100)), 50);
        assert_eq!(calculate_update_progress(100, Some(100)), 99);
        assert_eq!(calculate_update_progress(200, Some(100)), 99);
        assert_eq!(calculate_update_progress(50, None), 0);
        assert_eq!(calculate_update_progress(50, Some(0)), 0);
    }
}
