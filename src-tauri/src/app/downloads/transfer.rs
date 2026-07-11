use std::collections::HashMap;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::{Emitter, State};
use tokio::io::AsyncWriteExt;

use super::path::{
    checked_downloaded_size, cleanup_stale_partials, partial_path_for, resolve_safe_download_dir,
    unique_download_path, validate_download_size, validate_download_task_id, AUDIO_FILE_EXTENSIONS,
    DOWNLOAD_IDLE_TIMEOUT, MAX_AUDIO_DOWNLOAD_BYTES,
};

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

#[derive(Default)]
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

fn ensure_download_not_cancelled(cancellation: &DownloadCancellation) -> Result<(), String> {
    if cancellation.is_cancelled() {
        return Err("下载已取消".to_string());
    }
    Ok(())
}

#[derive(Default)]
pub(crate) struct DownloadTaskRegistry(
    parking_lot::Mutex<HashMap<String, Arc<DownloadCancellation>>>,
);

impl DownloadTaskRegistry {
    fn register(&self, task_id: &str) -> Result<Arc<DownloadCancellation>, String> {
        let mut tasks = self.0.lock();
        if tasks.contains_key(task_id) {
            return Err("下载任务已存在".to_string());
        }
        let cancellation = Arc::new(DownloadCancellation::default());
        tasks.insert(task_id.to_string(), cancellation.clone());
        Ok(cancellation)
    }

    fn cancel(&self, task_id: &str) -> bool {
        let tasks = self.0.lock();
        let Some(cancellation) = tasks.get(task_id) else {
            return false;
        };
        cancellation.cancel();
        true
    }

    fn finish(&self, task_id: &str) {
        self.0.lock().remove(task_id);
    }
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct DownloadedFile {
    filepath: String,
    filename: String,
}

fn emit_download_progress(
    app_handle: &tauri::AppHandle,
    event_name: &str,
    task_id: &str,
    url: &str,
    progress: u8,
) {
    let _ = app_handle.emit(
        event_name,
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
    idle_timeout: Duration,
    max_bytes: u64,
    cancellation: &DownloadCancellation,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u8),
{
    ensure_download_not_cancelled(cancellation)?;
    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建下载目录失败: {}", e))?;
    }
    let partial_path = partial_path_for(file_path)?;
    let result = stream_response_to_partial(
        response,
        &partial_path,
        idle_timeout,
        max_bytes,
        cancellation,
        &mut on_progress,
    )
    .await
    .and_then(|_| ensure_download_not_cancelled(cancellation));

    let result = match result {
        Ok(()) => commit_partial_download(&partial_path, file_path, cancellation).await,
        Err(error) => Err(error),
    };

    if result.is_ok() {
        on_progress(100);
    }

    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial_path).await;
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
) -> Result<(), String>
where
    F: FnMut(u8),
{
    let total_size = response.content_length().unwrap_or(0);
    if total_size > 0 {
        validate_download_size(total_size, max_bytes)?;
    }
    let mut file = tokio::fs::File::create(partial_path)
        .await
        .map_err(|e| format!("创建本地文件失败: {}", e))?;
    let mut downloaded = 0_u64;
    let mut last_progress = 0_u8;
    on_progress(0);
    loop {
        ensure_download_not_cancelled(cancellation)?;
        let chunk = tokio::select! {
            result = tokio::time::timeout(idle_timeout, response.chunk()) => {
                result.map_err(|_| "下载数据读取超时".to_string())?
                    .map_err(|e| format!("读取文件块失败: {}", e))?
            }
            _ = cancellation.cancelled() => return Err("下载已取消".to_string()),
        };
        let Some(chunk) = chunk else { break };
        downloaded = checked_downloaded_size(downloaded, chunk.len(), max_bytes)?;
        ensure_download_not_cancelled(cancellation)?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("保存文件数据失败: {}", e))?;
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
        .map_err(|e| format!("刷新本地文件失败: {}", e))
}

async fn commit_partial_download(
    partial_path: &Path,
    file_path: &Path,
    cancellation: &DownloadCancellation,
) -> Result<(), String> {
    ensure_download_not_cancelled(cancellation)?;
    if let Err(error) = tokio::fs::remove_file(file_path).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(format!("替换旧文件失败: {}", error));
        }
    }
    ensure_download_not_cancelled(cancellation)?;
    tokio::fs::rename(partial_path, file_path)
        .await
        .map_err(|e| format!("完成下载文件写入失败: {}", e))?;
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
    event_name: &str,
    task_id: &str,
    cancellation: &DownloadCancellation,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
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
        _ = cancellation.cancelled() => return Err("下载已取消".to_string()),
    };
    let response = response
        .map_err(|_| "下载响应超时".to_string())?
        .map_err(|e| format!("下载网络文件失败: {}", e))?;
    ensure_download_not_cancelled(cancellation)?;

    if !response.status().is_success() {
        return Err(format!("网络请求失败，响应码: {}", response.status()));
    }

    persist_download_response(
        response,
        file_path,
        DOWNLOAD_IDLE_TIMEOUT,
        MAX_AUDIO_DOWNLOAD_BYTES,
        cancellation,
        |progress| emit_download_progress(app_handle, event_name, task_id, url, progress),
    )
    .await
}

/// Tauri command to download a song to the local filesystem.
///
/// Streams the download to disk with progress events, avoiding loading
/// the entire file into memory. If `custom_dir` is provided and non-empty,
/// uses it; otherwise defaults to the executable's parent directory.
#[tauri::command]
pub(crate) async fn download_song_to_local(
    app_handle: tauri::AppHandle,
    client: State<'_, DownloadClient>,
    registry: State<'_, DownloadTaskRegistry>,
    url: String,
    filename: String,
    custom_dir: Option<String>,
    task_id: String,
) -> Result<DownloadedFile, String> {
    let task_id = validate_download_task_id(&task_id)?;
    let parsed_url = url::Url::parse(&url).map_err(|e| format!("无效下载地址: {}", e))?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("下载地址必须是 http 或 https".to_string());
    }

    let download_dir = resolve_safe_download_dir(&app_handle, custom_dir.as_deref())?;
    cleanup_stale_partials(&download_dir);
    let (file_path, actual_filename) =
        unique_download_path(&download_dir, &filename, Some("mp3"), AUDIO_FILE_EXTENSIONS)?;

    let cancellation = registry.register(&task_id)?;
    let result = download_with_progress(
        &client.0,
        &url,
        &file_path,
        "download-progress",
        &task_id,
        &cancellation,
        &app_handle,
    )
    .await;
    registry.finish(&task_id);
    result?;

    Ok(DownloadedFile {
        filepath: file_path.to_string_lossy().to_string(),
        filename: actual_filename,
    })
}

#[tauri::command]
pub(crate) fn cancel_download(
    registry: State<'_, DownloadTaskRegistry>,
    task_id: String,
) -> Result<bool, String> {
    let task_id = validate_download_task_id(&task_id)?;
    Ok(registry.cancel(&task_id))
}

#[cfg(test)]
#[path = "transfer_tests.rs"]
mod tests;
