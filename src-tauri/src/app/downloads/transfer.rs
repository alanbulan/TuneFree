use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::{Emitter, State};
use tokio::io::AsyncWriteExt;

use crate::app::error::{CommandError, CommandResult};

use super::commands::run_downloads_blocking;
use super::meta::{save_download_metadata, DownloadMetadataInput};
use super::path::{
    checked_downloaded_size, cleanup_stale_partials, download_failed, partial_path_for,
    resolve_safe_download_dir, unique_download_path, validate_download_size,
    validate_download_task_id, AUDIO_FILE_EXTENSIONS, DOWNLOAD_IDLE_TIMEOUT,
    MAX_AUDIO_DOWNLOAD_BYTES,
};
use super::DownloadMetaStore;

const DOWNLOAD_PROGRESS_EVENT: &str = "download-progress";

/// Progress payload emitted during file downloads.
///
/// Contains the source URL and a 0–100 progress percentage.
/// Emitted via the `download-progress` event.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadProgress {
    task_id: String,
    url: String,
    progress: u8,
}

#[derive(Clone)]
pub(crate) struct DownloadClient(pub(crate) reqwest::Client);

#[derive(Debug, Default)]
pub(crate) struct DownloadCancellation {
    cancelled: AtomicBool,
    notify: tokio::sync::Notify,
}

impl DownloadCancellation {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_one();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.notify.notified().await;
    }
}

fn ensure_download_not_cancelled(cancellation: &DownloadCancellation) -> CommandResult<()> {
    if cancellation.is_cancelled() {
        return Err(CommandError::cancelled("下载已取消"));
    }
    Ok(())
}

/// Tracks in-flight download tasks: cancellation handles keyed by task id,
/// plus the set of partial file paths owned by running transfers so the stale
/// cleanup pass never deletes an active temp file.
#[derive(Default)]
pub(crate) struct DownloadTaskRegistry {
    tasks: parking_lot::Mutex<HashMap<String, Arc<DownloadCancellation>>>,
    active_partials: parking_lot::Mutex<HashSet<PathBuf>>,
}

impl DownloadTaskRegistry {
    fn register(&self, task_id: &str) -> CommandResult<Arc<DownloadCancellation>> {
        let mut tasks = self.tasks.lock();
        if tasks.contains_key(task_id) {
            return Err(CommandError::busy("下载任务已存在"));
        }
        let cancellation = Arc::new(DownloadCancellation::default());
        tasks.insert(task_id.to_string(), cancellation.clone());
        Ok(cancellation)
    }

    fn cancel(&self, task_id: &str) -> bool {
        let tasks = self.tasks.lock();
        let Some(cancellation) = tasks.get(task_id) else {
            return false;
        };
        cancellation.cancel();
        true
    }

    fn finish(&self, task_id: &str) {
        self.tasks.lock().remove(task_id);
    }

    fn track_partial(&self, path: &Path) {
        self.active_partials.lock().insert(path.to_path_buf());
    }

    fn untrack_partial(&self, path: &Path) {
        self.active_partials.lock().remove(path);
    }

    fn active_partial_snapshot(&self) -> HashSet<PathBuf> {
        self.active_partials.lock().clone()
    }
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct DownloadedFile {
    filepath: String,
    filename: String,
}

fn emit_download_progress(app_handle: &tauri::AppHandle, task_id: &str, url: &str, progress: u8) {
    let _ = app_handle.emit(
        DOWNLOAD_PROGRESS_EVENT,
        DownloadProgress {
            task_id: task_id.to_string(),
            url: url.to_string(),
            progress,
        },
    );
}

async fn persist_download_response<F>(
    response: reqwest::Response,
    file_path: &Path,
    partial_path: &Path,
    idle_timeout: Duration,
    max_bytes: u64,
    cancellation: &DownloadCancellation,
    mut on_progress: F,
) -> CommandResult<()>
where
    F: FnMut(u8),
{
    ensure_download_not_cancelled(cancellation)?;
    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| download_failed(format!("创建下载目录失败: {}", e)))?;
    }
    let result = stream_response_to_partial(
        response,
        partial_path,
        idle_timeout,
        max_bytes,
        cancellation,
        &mut on_progress,
    )
    .await
    .and_then(|_| ensure_download_not_cancelled(cancellation));

    let result = match result {
        Ok(()) => commit_partial_download(partial_path, file_path, cancellation).await,
        Err(error) => Err(error),
    };

    if result.is_ok() {
        on_progress(100);
    }

    if result.is_err() {
        let _ = tokio::fs::remove_file(partial_path).await;
    }

    result
}

async fn stream_response_to_partial<F>(
    mut response: reqwest::Response,
    partial_path: &Path,
    idle_timeout: Duration,
    max_bytes: u64,
    cancellation: &DownloadCancellation,
    on_progress: &mut F,
) -> CommandResult<()>
where
    F: FnMut(u8),
{
    let total_size = response.content_length().unwrap_or(0);
    if total_size > 0 {
        validate_download_size(total_size, max_bytes)?;
    }
    let mut file = tokio::fs::File::create(partial_path)
        .await
        .map_err(|e| download_failed(format!("创建本地文件失败: {}", e)))?;
    let mut downloaded = 0_u64;
    let mut last_progress = 0_u8;
    on_progress(0);
    loop {
        ensure_download_not_cancelled(cancellation)?;
        let chunk = tokio::select! {
            result = tokio::time::timeout(idle_timeout, response.chunk()) => {
                result.map_err(|_| download_failed("下载数据读取超时"))?
                    .map_err(|e| {
                        // reqwest errors can embed the source URL; keep the
                        // detail in the log only.
                        log::warn!("读取文件块失败: {}", e);
                        download_failed("读取文件块失败")
                    })?
            }
            _ = cancellation.cancelled() => return Err(CommandError::cancelled("下载已取消")),
        };
        let Some(chunk) = chunk else { break };
        downloaded = checked_downloaded_size(downloaded, chunk.len(), max_bytes)?;
        ensure_download_not_cancelled(cancellation)?;
        file.write_all(&chunk)
            .await
            .map_err(|e| download_failed(format!("保存文件数据失败: {}", e)))?;
        if total_size > 0 {
            let progress = downloaded
                .saturating_mul(100)
                .checked_div(total_size)
                .unwrap_or(0)
                .min(99) as u8;
            if progress != last_progress {
                last_progress = progress;
                on_progress(progress);
            }
        }
    }
    file.flush()
        .await
        .map_err(|e| download_failed(format!("刷新本地文件失败: {}", e)))
}

async fn commit_partial_download(
    partial_path: &Path,
    file_path: &Path,
    cancellation: &DownloadCancellation,
) -> CommandResult<()> {
    ensure_download_not_cancelled(cancellation)?;
    // `rename` replaces an existing destination on both Windows and Unix, so
    // the old file is only ever swapped out atomically once the new one is
    // fully written — never deleted up front.
    tokio::fs::rename(partial_path, file_path)
        .await
        .map_err(|e| download_failed(format!("完成下载文件写入失败: {}", e)))?;
    if let Err(error) = ensure_download_not_cancelled(cancellation) {
        let _ = tokio::fs::remove_file(file_path).await;
        return Err(error);
    }
    Ok(())
}

/// Downloads a file with streaming writes and progress reporting.
///
/// Streams response chunks directly to disk (avoiding loading the entire
/// file into memory) and emits progress events via `app_handle.emit()`.
/// The transfer is written to a temporary `.partial-*` file and renamed only
/// after the full response is saved.
async fn download_with_progress(
    client: &reqwest::Client,
    url: &str,
    file_path: &Path,
    partial_path: &Path,
    task_id: &str,
    cancellation: &DownloadCancellation,
    app_handle: &tauri::AppHandle,
) -> CommandResult<()> {
    ensure_download_not_cancelled(cancellation)?;
    let response = tokio::select! {
        result = tokio::time::timeout(
            DOWNLOAD_IDLE_TIMEOUT,
            client
                .get(url)
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                )
                .send(),
        ) => result,
        _ = cancellation.cancelled() => return Err(CommandError::cancelled("下载已取消")),
    };
    let response = response
        .map_err(|_| download_failed("下载响应超时"))?
        .map_err(|e| {
            log::warn!("下载网络文件失败: {}", e);
            download_failed("下载网络文件失败")
        })?;
    ensure_download_not_cancelled(cancellation)?;

    if !response.status().is_success() {
        return Err(download_failed(format!(
            "网络请求失败，响应码: {}",
            response.status()
        )));
    }

    persist_download_response(
        response,
        file_path,
        partial_path,
        DOWNLOAD_IDLE_TIMEOUT,
        MAX_AUDIO_DOWNLOAD_BYTES,
        cancellation,
        |progress| emit_download_progress(app_handle, task_id, url, progress),
    )
    .await
}

struct PreparedDownload {
    download_dir: PathBuf,
    file_path: PathBuf,
    filename: String,
    partial_path: PathBuf,
}

/// Resolves the target paths on a blocking thread and runs the stale-partial
/// cleanup pass, skipping partials owned by in-flight downloads.
async fn prepare_download_paths(
    app_handle: tauri::AppHandle,
    filename: String,
    active_partials: HashSet<PathBuf>,
) -> CommandResult<PreparedDownload> {
    run_downloads_blocking(move || {
        let download_dir = resolve_safe_download_dir(&app_handle)?;
        cleanup_stale_partials(&download_dir, &active_partials);
        let (file_path, filename) =
            unique_download_path(&download_dir, &filename, Some("mp3"), AUDIO_FILE_EXTENSIONS)?;
        let partial_path = partial_path_for(&file_path)?;
        Ok(PreparedDownload {
            download_dir,
            file_path,
            filename,
            partial_path,
        })
    })
    .await
}

/// Tauri command to download a song to the local filesystem.
///
/// Streams the download to disk with progress events. The target directory is
/// always the backend-resolved effective download directory.
#[tauri::command]
pub(crate) async fn download_song_to_local(
    app_handle: tauri::AppHandle,
    client: State<'_, DownloadClient>,
    registry: State<'_, DownloadTaskRegistry>,
    url: String,
    filename: String,
    task_id: String,
    metadata: DownloadMetadataInput,
) -> CommandResult<DownloadedFile> {
    metadata.validate()?;
    let task_id = validate_download_task_id(&task_id)?;
    let parsed_url = url::Url::parse(&url)
        .map_err(|e| CommandError::invalid_argument(format!("无效下载地址: {}", e)))?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err(CommandError::invalid_argument(
            "下载地址必须是 http 或 https",
        ));
    }

    let cancellation = registry.register(&task_id)?;
    let prepared = match prepare_download_paths(
        app_handle.clone(),
        filename,
        registry.active_partial_snapshot(),
    )
    .await
    {
        Ok(prepared) => prepared,
        Err(error) => {
            registry.finish(&task_id);
            return Err(error);
        }
    };

    registry.track_partial(&prepared.partial_path);
    let result = download_with_progress(
        &client.0,
        &url,
        &prepared.file_path,
        &prepared.partial_path,
        &task_id,
        &cancellation,
        &app_handle,
    )
    .await;
    registry.untrack_partial(&prepared.partial_path);
    registry.finish(&task_id);
    result?;
    let store = DownloadMetaStore::resolve(&app_handle);
    let dir = prepared.download_dir;
    let saved_name = prepared.filename.clone();
    run_downloads_blocking(move || save_download_metadata(&dir, &store, saved_name, metadata))
        .await
        .map_err(|error| {
            CommandError::io(format!(
                "音频已保存为 {}，但下载记录保存失败: {}",
                prepared.filename, error
            ))
        })?;

    Ok(DownloadedFile {
        filepath: prepared.file_path.to_string_lossy().to_string(),
        filename: prepared.filename,
    })
}

#[tauri::command]
pub(crate) fn cancel_download(
    registry: State<'_, DownloadTaskRegistry>,
    task_id: String,
) -> CommandResult<bool> {
    let task_id = validate_download_task_id(&task_id)?;
    Ok(registry.cancel(&task_id))
}

#[cfg(test)]
#[path = "transfer_tests.rs"]
mod tests;

#[cfg(all(test, windows))]
#[path = "__tests__/transfer_commands.rs"]
mod command_tests;
