use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::app::error::{CommandError, CommandResult, ErrorCode};

use super::meta::{read_downloads_json, write_downloads_json, DownloadMetaEntry};
use super::path::{
    canonicalize_dir, clear_approved_download_dir, display_path, resolve_default_download_dir,
    resolve_safe_download_dir, sanitize_filename, save_approved_download_dir,
    verified_existing_download_path, AUDIO_FILE_EXTENSIONS,
};
use super::DownloadMetaStore;

/// Runs blocking download filesystem work off the async runtime threads.
pub(super) async fn run_downloads_blocking<T, F>(operation: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CommandResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            log::warn!("下载后台任务异常: {}", error);
            CommandError::internal("下载后台任务异常")
        })?
}

/// Result returned by resolve_local_playback for offline playback.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedPlayback {
    filepath: String,
    song: serde_json::Value,
    quality: String,
}

fn scan_download_dir_blocking(
    app_handle: &tauri::AppHandle,
    store: &DownloadMetaStore,
) -> CommandResult<Vec<DownloadMetaEntry>> {
    let dir = resolve_safe_download_dir(app_handle)?;
    store.with_lock(|| {
        let mut entries = read_downloads_json(&dir)?;
        let before = entries.len();
        let mut kept = Vec::with_capacity(before);
        for mut entry in entries.drain(..) {
            // One resolution per entry: it both validates that the file still
            // lives inside the download directory and yields its size.
            let path =
                match verified_existing_download_path(&dir, &entry.filename, AUDIO_FILE_EXTENSIONS)
                {
                    Ok(path) => path,
                    Err(error)
                        if matches!(
                            error.code,
                            ErrorCode::NotFound | ErrorCode::InvalidArgument
                        ) =>
                    {
                        continue
                    }
                    Err(error) => return Err(error),
                };
            if let Ok(meta) = std::fs::metadata(path) {
                entry.size = meta.len();
            }
            kept.push(entry);
        }

        // Entries removed means files were deleted externally; persist the pruned list.
        if kept.len() != before {
            write_downloads_json(&dir, &kept)?;
            store.invalidate();
        }

        kept.sort_by(|a, b| {
            b.create_time
                .partial_cmp(&a.create_time)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(kept)
    })
}

/// Scans the download directory and returns all downloads with metadata.
///
/// Pure read operation: it never deletes partial files (cleanup only runs
/// when a download starts).
#[tauri::command]
pub(crate) async fn scan_download_dir(
    app_handle: tauri::AppHandle,
) -> CommandResult<Vec<DownloadMetaEntry>> {
    let store = DownloadMetaStore::resolve(&app_handle);
    run_downloads_blocking(move || scan_download_dir_blocking(&app_handle, &store)).await
}

fn delete_download_file_blocking(
    app_handle: &tauri::AppHandle,
    store: &DownloadMetaStore,
    filename: &str,
) -> CommandResult<()> {
    let dir = resolve_safe_download_dir(app_handle)?;
    let safe_filename = sanitize_filename(filename, None, AUDIO_FILE_EXTENSIONS)?;

    store.with_lock(|| {
        let mut entries = read_downloads_json(&dir)?;
        match verified_existing_download_path(&dir, &safe_filename, AUDIO_FILE_EXTENSIONS) {
            Ok(file_path) => std::fs::remove_file(&file_path)
                .map_err(|e| CommandError::io(format!("删除文件失败: {}", e)))?,
            Err(error) if error.code == ErrorCode::NotFound => {}
            Err(error) => return Err(error),
        }

        let before = entries.len();
        entries.retain(|e| e.filename != safe_filename);
        if entries.len() != before {
            write_downloads_json(&dir, &entries)?;
            store.invalidate();
        }
        Ok(())
    })
}

#[cfg(all(test, windows))]
#[path = "__tests__/commands.rs"]
mod tests;

/// Deletes a downloaded file and removes its metadata entry.
#[tauri::command]
pub(crate) async fn delete_download_file(
    app_handle: tauri::AppHandle,
    filename: String,
) -> CommandResult<()> {
    let store = DownloadMetaStore::resolve(&app_handle);
    run_downloads_blocking(move || delete_download_file_blocking(&app_handle, &store, &filename))
        .await
}

fn resolve_local_playback_blocking(
    app_handle: &tauri::AppHandle,
    store: &DownloadMetaStore,
    song_id: &str,
    source: &str,
    quality: Option<String>,
) -> CommandResult<Option<ResolvedPlayback>> {
    let dir = resolve_safe_download_dir(app_handle)?;
    let mut matches = store.matching_entries(&dir, song_id, source)?;

    if matches.is_empty() {
        return Ok(None);
    }

    if let Some(ref q) = quality {
        matches.sort_by_key(|e| if e.quality == *q { 0 } else { 1 });
    }

    for entry in matches {
        if let Ok(file_path) =
            verified_existing_download_path(&dir, &entry.filename, AUDIO_FILE_EXTENSIONS)
        {
            app_handle
                .asset_protocol_scope()
                .allow_file(&file_path)
                .map_err(|e| CommandError::internal(format!("授权本地音频播放失败: {}", e)))?;
            return Ok(Some(ResolvedPlayback {
                filepath: file_path.to_string_lossy().to_string(),
                song: entry.song.clone(),
                quality: entry.quality.clone(),
            }));
        }
    }

    Ok(None)
}

/// Resolves a local file path for offline playback.
///
/// Searches downloads.json for a matching song (by ID and source), preferring
/// the requested quality but falling back to any available quality.
#[tauri::command]
pub(crate) async fn resolve_local_playback(
    app_handle: tauri::AppHandle,
    song_id: String,
    source: String,
    quality: Option<String>,
) -> CommandResult<Option<ResolvedPlayback>> {
    let store = DownloadMetaStore::resolve(&app_handle);
    run_downloads_blocking(move || {
        resolve_local_playback_blocking(&app_handle, &store, &song_id, &source, quality)
    })
    .await
}

/// Opens the effective download directory in the OS file explorer.
#[tauri::command]
pub(crate) async fn open_download_dir(app_handle: tauri::AppHandle) -> CommandResult<()> {
    run_downloads_blocking(move || {
        let dir = display_path(&resolve_safe_download_dir(&app_handle)?);
        #[cfg(target_os = "windows")]
        let launcher = "explorer";
        #[cfg(target_os = "macos")]
        let launcher = "open";
        #[cfg(target_os = "linux")]
        let launcher = "xdg-open";
        std::process::Command::new(launcher)
            .arg(&dir)
            .spawn()
            .map_err(|e| CommandError::io(format!("打开下载目录失败: {}", e)))?;
        Ok(())
    })
    .await
}

/// Returns the effective download directory (single source of truth).
///
/// The approved directory when one is recorded, otherwise the default
/// directory; the directory is created on demand.
#[tauri::command]
pub(crate) async fn get_download_dir(app_handle: tauri::AppHandle) -> CommandResult<String> {
    run_downloads_blocking(move || {
        resolve_safe_download_dir(&app_handle).map(|dir| display_path(&dir))
    })
    .await
}

/// Returns the default download directory without creating it.
///
/// Portable installs (portable.txt next to the exe) resolve to the exe
/// directory; installed builds resolve to `<OS downloads>/TuneFree`.
#[tauri::command]
pub(crate) fn get_default_download_dir(app_handle: tauri::AppHandle) -> CommandResult<String> {
    resolve_default_download_dir(&app_handle).map(|dir| display_path(&dir))
}

/// Drops the approved directory so downloads fall back to the default one.
///
/// Returns the directory now in effect.
#[tauri::command]
pub(crate) async fn reset_download_dir(app_handle: tauri::AppHandle) -> CommandResult<String> {
    run_downloads_blocking(move || {
        clear_approved_download_dir(&app_handle)?;
        resolve_default_download_dir(&app_handle).map(|dir| display_path(&dir))
    })
    .await
}

/// Opens a folder picker and records the selection as the approved directory.
///
/// Wraps the dialog callback in a 5-minute timeout to prevent indefinite
/// blocking if the user never responds. Returns `None` when cancelled.
#[tauri::command]
pub(crate) async fn select_download_dir(
    app_handle: tauri::AppHandle,
) -> CommandResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    app_handle.dialog().file().pick_folder(move |folder_path| {
        let path = folder_path.and_then(|p| match p {
            tauri_plugin_dialog::FilePath::Path(path_buf) => {
                Some(path_buf.to_string_lossy().into_owned())
            }
            tauri_plugin_dialog::FilePath::Url(url) => url
                .to_file_path()
                .ok()
                .map(|pb| pb.to_string_lossy().into_owned()),
        });
        let _ = tx.send(path);
    });

    // 5-minute timeout to prevent indefinite blocking.
    let selected = match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => {
            return Err(CommandError::internal(format!("对话框通道错误: {}", e)));
        }
        Err(_) => {
            return Err(CommandError::new(
                ErrorCode::Timeout,
                "选择下载目录超时（5分钟）",
            ));
        }
    };

    let Some(path) = selected else {
        return Ok(None);
    };
    run_downloads_blocking(move || {
        let canonical = canonicalize_dir(PathBuf::from(path))?;
        save_approved_download_dir(&app_handle, &canonical)?;
        Ok(Some(display_path(&canonical)))
    })
    .await
}
