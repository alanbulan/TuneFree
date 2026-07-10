pub mod api;
pub mod recommendation;
pub mod server;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, Window, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::io::AsyncWriteExt;

use recommendation::{
    LibrarySnapshot, LlmConfigInput, LlmConfigView, LlmProviderTestResult, RecSong,
    RecommendationEvent, RecommendationFeedback, RecommendationItem, RecommendationJob,
    RecommendationMaintenanceStats, RecommendationQuery, RecommendationService,
};

/// Progress payload emitted during file downloads.
///
/// Contains the source URL and a 0–100 progress percentage.
/// Emitted via the `download-progress` event.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    task_id: String,
    url: String,
    progress: u8,
}

/// Progress payload emitted during update downloads.
///
/// Emitted via the `update-progress` event.
#[derive(Clone, serde::Serialize)]
struct UpdateProgress {
    progress: u8,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}

#[derive(Clone)]
struct DownloadClient(reqwest::Client);

#[derive(Default)]
struct DownloadCancellation {
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

#[derive(Default)]
struct DownloadTaskRegistry(parking_lot::Mutex<HashMap<String, Arc<DownloadCancellation>>>);

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

#[derive(Clone)]
struct LocalServerState {
    port: u16,
}

#[derive(Clone, serde::Serialize)]
struct DownloadedFile {
    filepath: String,
    filename: String,
}

/// Application lifecycle state shared across the app.
///
/// Tracks whether the app is quitting (to prevent the desktop-lyric window
/// from closing prematurely) and holds a shutdown signal sender for
/// gracefully stopping the local HTTP server.
#[derive(Clone)]
struct AppLifecycleState {
    is_quitting: Arc<AtomicBool>,
    shutdown_tx: tokio::sync::watch::Sender<bool>,
}

#[tauri::command]
fn get_local_server_port(state: State<'_, LocalServerState>) -> u16 {
    state.port
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct DesktopLyricWindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

const DESKTOP_LYRIC_BOUNDS_FILE: &str = "desktop-lyric-window.json";

fn desktop_lyric_bounds_path<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法解析应用配置目录: {}", e))?;
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("无法创建应用配置目录: {}", e))?;
    Ok(app_dir.join(DESKTOP_LYRIC_BOUNDS_FILE))
}

fn is_valid_desktop_lyric_bounds(bounds: &DesktopLyricWindowBounds) -> bool {
    bounds.width >= 400 && bounds.height >= 200
}

fn read_desktop_lyric_bounds<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Option<DesktopLyricWindowBounds> {
    let path = desktop_lyric_bounds_path(app_handle).ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let bounds = serde_json::from_str::<DesktopLyricWindowBounds>(&raw).ok()?;
    is_valid_desktop_lyric_bounds(&bounds).then_some(bounds)
}

fn save_desktop_lyric_bounds<R: Runtime>(window: &Window<R>) {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }

    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };

    let bounds = DesktopLyricWindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };

    if !is_valid_desktop_lyric_bounds(&bounds) {
        return;
    }

    if let Ok(path) = desktop_lyric_bounds_path(window.app_handle()) {
        if let Ok(json) = serde_json::to_string_pretty(&bounds) {
            let _ = std::fs::write(path, json);
        }
    }
}

fn apply_desktop_lyric_bounds<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    if let Some(bounds) = read_desktop_lyric_bounds(window.app_handle()) {
        let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
        let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
    }
}

fn acquire_process_instance() -> Option<single_instance::SingleInstance> {
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
fn show_main_window(app_handle: &tauri::AppHandle) {
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
fn quit_app_inner(app_handle: &tauri::AppHandle) {
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
fn quit_app(app_handle: tauri::AppHandle) {
    quit_app_inner(&app_handle);
}

#[tauri::command]
async fn show_desktop_lyric_window(app_handle: tauri::AppHandle, lock: bool) -> Result<(), String> {
    let lyric_window = app_handle
        .get_webview_window("desktop-lyric")
        .ok_or_else(|| "找不到桌面歌词窗口".to_string())?;

    apply_desktop_lyric_bounds(&lyric_window);
    lyric_window
        .show()
        .map_err(|e| format!("显示桌面歌词失败: {}", e))?;
    apply_desktop_lyric_bounds(&lyric_window);
    lyric_window
        .set_ignore_cursor_events(lock)
        .map_err(|e| format!("设置桌面歌词锁定状态失败: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn hide_desktop_lyric_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    let lyric_window = app_handle
        .get_webview_window("desktop-lyric")
        .ok_or_else(|| "找不到桌面歌词窗口".to_string())?;

    if lyric_window.is_visible().unwrap_or(false) {
        if let (Ok(position), Ok(size)) = (lyric_window.outer_position(), lyric_window.outer_size())
        {
            let bounds = DesktopLyricWindowBounds {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            };

            if is_valid_desktop_lyric_bounds(&bounds) {
                let path = desktop_lyric_bounds_path(&app_handle)?;
                let json = serde_json::to_string_pretty(&bounds)
                    .map_err(|e| format!("序列化桌面歌词窗口位置失败: {}", e))?;
                std::fs::write(path, json)
                    .map_err(|e| format!("保存桌面歌词窗口位置失败: {}", e))?;
            }
        }
    }

    lyric_window
        .hide()
        .map_err(|e| format!("隐藏桌面歌词失败: {}", e))?;
    Ok(())
}

async fn run_recommendation_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("推荐后台任务异常: {}", error))?
}

#[tauri::command]
async fn log_recommendation_event(
    state: State<'_, RecommendationService>,
    event: RecommendationEvent,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.log_event(event))
        .await
        .map_err(|e| {
            log::error!("{}", e);
            e
        })
}

#[tauri::command]
async fn sync_recommendation_library(
    state: State<'_, RecommendationService>,
    snapshot: LibrarySnapshot,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.sync_library(snapshot)).await
}

#[tauri::command]
async fn get_home_recommendations(
    state: State<'_, RecommendationService>,
    query: RecommendationQuery,
) -> Result<Vec<RecommendationItem>, String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.home_recommendations(query)).await
}

#[tauri::command]
async fn get_similar_songs(
    state: State<'_, RecommendationService>,
    song: RecSong,
    limit: Option<usize>,
) -> Result<Vec<RecommendationItem>, String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.similar_songs(song, limit)).await
}

#[tauri::command]
async fn start_recommendation_job(
    state: State<'_, RecommendationService>,
    query: RecommendationQuery,
) -> Result<RecommendationJob, String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.start_recommendation_job(query)).await
}

#[tauri::command]
async fn get_recommendation_job(
    state: State<'_, RecommendationService>,
    job_id: String,
) -> Result<Option<RecommendationJob>, String> {
    Ok(state.get_recommendation_job(job_id))
}

#[tauri::command]
async fn get_latest_recommendation_job(
    state: State<'_, RecommendationService>,
) -> Result<Option<RecommendationJob>, String> {
    Ok(state.get_latest_recommendation_job())
}

#[tauri::command]
async fn dismiss_recommendation(
    state: State<'_, RecommendationService>,
    song: RecSong,
    reason: Option<String>,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.dismiss(song, reason)).await
}

#[tauri::command]
async fn save_recommendation_feedback(
    state: State<'_, RecommendationService>,
    feedback: RecommendationFeedback,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.save_feedback(feedback)).await
}

#[tauri::command]
async fn rebuild_recommendation_index(
    state: State<'_, RecommendationService>,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.rebuild_index()).await
}

#[tauri::command]
async fn get_llm_config(state: State<'_, RecommendationService>) -> Result<LlmConfigView, String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.get_llm_config()).await
}

#[tauri::command]
async fn save_llm_config(
    state: State<'_, RecommendationService>,
    config: LlmConfigInput,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.save_llm_config(config)).await
}

#[tauri::command]
async fn test_llm_provider(
    state: State<'_, RecommendationService>,
    config: Option<LlmConfigInput>,
) -> Result<LlmProviderTestResult, String> {
    state.test_llm_provider(config).await
}

#[tauri::command]
async fn clear_recommendation_data(
    state: State<'_, RecommendationService>,
) -> Result<RecommendationMaintenanceStats, String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.clear_data()).await
}

/// Resolves the download directory for saving files.
///
/// If `use_default` is `true`, returns the executable's parent directory
/// (portable mode). Otherwise, returns the OS download directory.
///
/// Replaces the previous `unwrap()` calls with proper error handling.
fn resolve_download_dir(
    app_handle: &tauri::AppHandle,
    use_default: bool,
) -> Result<PathBuf, String> {
    if use_default {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                return Ok(parent.to_path_buf());
            }
        }
    }
    app_handle
        .path()
        .download_dir()
        .map_err(|e| format!("Cannot determine download dir: {}", e))
}

const AUDIO_FILE_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "m4a", "aac", "ogg"];
const DOWNLOAD_DIR_CONFIG_FILE: &str = "download-dir.txt";
const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_AUDIO_DOWNLOAD_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_DOWNLOAD_TASK_ID_LEN: usize = 128;

fn validate_download_task_id(task_id: &str) -> Result<String, String> {
    let task_id = task_id.trim();
    if task_id.is_empty() || task_id.len() > MAX_DOWNLOAD_TASK_ID_LEN {
        return Err("下载任务 ID 无效".to_string());
    }
    if !task_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'-' | b'_'))
    {
        return Err("下载任务 ID 包含非法字符".to_string());
    }
    Ok(task_id.to_string())
}

fn validate_download_size(size: u64, max_bytes: u64) -> Result<(), String> {
    if size > max_bytes {
        return Err(format!(
            "下载文件超过大小限制（最大 {} MiB）",
            max_bytes / 1024 / 1024
        ));
    }
    Ok(())
}

fn checked_downloaded_size(
    downloaded: u64,
    chunk_size: usize,
    max_bytes: u64,
) -> Result<u64, String> {
    let next = downloaded
        .checked_add(chunk_size as u64)
        .ok_or_else(|| "下载文件大小溢出".to_string())?;
    validate_download_size(next, max_bytes)?;
    Ok(next)
}

fn ensure_download_not_cancelled(cancellation: &DownloadCancellation) -> Result<(), String> {
    if cancellation.is_cancelled() {
        return Err("下载已取消".to_string());
    }
    Ok(())
}

fn download_dir_config_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法解析应用配置目录: {}", e))?;
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("无法创建应用配置目录: {}", e))?;
    Ok(app_dir.join(DOWNLOAD_DIR_CONFIG_FILE))
}

fn save_approved_download_dir(app_handle: &tauri::AppHandle, dir: &Path) -> Result<(), String> {
    let path = download_dir_config_path(app_handle)?;
    std::fs::write(path, dir.to_string_lossy().as_ref())
        .map_err(|e| format!("保存下载目录配置失败: {}", e))
}

fn read_approved_download_dir(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let path = download_dir_config_path(app_handle).ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    PathBuf::from(trimmed).canonicalize().ok()
}

fn canonicalize_dir(path: PathBuf) -> Result<PathBuf, String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("无法创建下载目录: {}", e))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("无法解析下载目录: {}", e))?;
    if !canonical.is_dir() {
        return Err("下载路径不是有效目录".to_string());
    }
    Ok(canonical)
}

fn resolve_safe_download_dir(
    app_handle: &tauri::AppHandle,
    custom_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let dir = match custom_dir.map(str::trim).filter(|d| !d.is_empty()) {
        Some(dir) => {
            let canonical = canonicalize_dir(PathBuf::from(dir))?;
            if let Some(approved) = read_approved_download_dir(app_handle) {
                if canonical != approved {
                    return Err("下载目录未授权，请在设置中重新选择下载目录".to_string());
                }
            } else {
                // Migration path for users who already had a custom directory in localStorage.
                save_approved_download_dir(app_handle, &canonical)?;
            }
            canonical
        }
        None => canonicalize_dir(resolve_download_dir(app_handle, true)?)?,
    };
    Ok(dir)
}

fn has_windows_drive_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn is_windows_reserved_basename(stem: &str) -> bool {
    let upper = stem.trim_matches('_').to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
        || upper
            .strip_prefix("LPT")
            .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
}

fn sanitize_filename(
    input: &str,
    fallback_ext: Option<&str>,
    allowed_exts: &[&str],
) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("文件名不能为空".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || Path::new(trimmed).is_absolute() {
        return Err("文件名不能包含路径".to_string());
    }
    if has_windows_drive_prefix(trimmed) {
        return Err("文件名不能包含 Windows 盘符前缀".to_string());
    }

    let mut sanitized: String = trimmed
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                ch
            }
        })
        .collect();
    sanitized = sanitized
        .trim()
        .trim_end_matches(&[' ', '.'][..])
        .to_string();

    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        return Err("文件名不能为空".to_string());
    }

    let (mut stem, ext) = match sanitized.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => {
            (stem.to_string(), ext.to_ascii_lowercase())
        }
        _ => {
            let fallback = fallback_ext.ok_or_else(|| "文件名缺少扩展名".to_string())?;
            (sanitized, fallback.to_ascii_lowercase())
        }
    };

    if !allowed_exts.iter().any(|allowed| *allowed == ext) {
        return Err(format!("不支持的文件扩展名: {}", ext));
    }

    stem = stem.trim().trim_end_matches(&[' ', '.'][..]).to_string();
    if stem.is_empty() || stem == "." || stem == ".." {
        return Err("文件名不能为空".to_string());
    }
    if is_windows_reserved_basename(&stem) {
        stem = format!("_{}", stem);
    }

    if stem.chars().count() > 160 {
        stem = stem.chars().take(160).collect();
    }

    Ok(format!("{}.{}", stem, ext))
}

fn split_filename(filename: &str) -> (String, String) {
    filename
        .rsplit_once('.')
        .map(|(stem, ext)| (stem.to_string(), ext.to_string()))
        .unwrap_or_else(|| (filename.to_string(), "".to_string()))
}

fn safe_join_download_dir(
    dir: &Path,
    filename: &str,
    fallback_ext: Option<&str>,
    allowed_exts: &[&str],
) -> Result<(PathBuf, String), String> {
    let canonical_dir = canonicalize_dir(dir.to_path_buf())?;
    let safe_filename = sanitize_filename(filename, fallback_ext, allowed_exts)?;
    let path = canonical_dir.join(&safe_filename);
    if path.parent() != Some(canonical_dir.as_path()) {
        return Err("文件路径越界".to_string());
    }
    Ok((path, safe_filename))
}

fn unique_download_path(
    dir: &Path,
    filename: &str,
    fallback_ext: Option<&str>,
    allowed_exts: &[&str],
) -> Result<(PathBuf, String), String> {
    let (initial_path, safe_filename) =
        safe_join_download_dir(dir, filename, fallback_ext, allowed_exts)?;
    if !initial_path.exists() {
        return Ok((initial_path, safe_filename));
    }

    let (stem, ext) = split_filename(&safe_filename);
    for counter in 1..10_000 {
        let candidate_filename = format!("{} ({}).{}", stem, counter, ext);
        let (candidate, candidate_filename) =
            safe_join_download_dir(dir, &candidate_filename, fallback_ext, allowed_exts)?;
        if !candidate.exists() {
            return Ok((candidate, candidate_filename));
        }
    }

    Err("无法生成不重复的文件名".to_string())
}

fn verified_existing_download_path(
    dir: &Path,
    filename: &str,
    allowed_exts: &[&str],
) -> Result<PathBuf, String> {
    let (path, _) = safe_join_download_dir(dir, filename, None, allowed_exts)?;
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    let canonical_dir = canonicalize_dir(dir.to_path_buf())?;
    let canonical_file = path
        .canonicalize()
        .map_err(|e| format!("无法解析本地文件: {}", e))?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err("文件路径越界".to_string());
    }
    Ok(canonical_file)
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn partial_path_for(file_path: &Path) -> Result<PathBuf, String> {
    let filename = file_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "无法生成临时下载文件名".to_string())?;
    Ok(file_path.with_file_name(format!("{}.partial-{}", filename, now_millis())))
}

fn cleanup_stale_partials(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if name.contains(".partial-") {
            let _ = std::fs::remove_file(path);
        }
    }
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

async fn persist_download_response<F>(
    mut response: reqwest::Response,
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

    let result = async {
        ensure_download_not_cancelled(cancellation)?;
        let total_size = response.content_length().unwrap_or(0);
        if total_size > 0 {
            validate_download_size(total_size, max_bytes)?;
        }

        let mut downloaded: u64 = 0;
        let mut last_progress: u8 = 0;
        ensure_download_not_cancelled(cancellation)?;
        let mut file = tokio::fs::File::create(&partial_path)
            .await
            .map_err(|e| format!("创建本地文件失败: {}", e))?;

        on_progress(0);

        loop {
            ensure_download_not_cancelled(cancellation)?;
            let chunk = tokio::select! {
                result = tokio::time::timeout(idle_timeout, response.chunk()) => {
                    result
                        .map_err(|_| "下载数据读取超时".to_string())?
                        .map_err(|e| format!("读取文件块失败: {}", e))?
                }
                _ = cancellation.cancelled() => return Err("下载已取消".to_string()),
            };
            ensure_download_not_cancelled(cancellation)?;
            let Some(chunk) = chunk else {
                break;
            };

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

        ensure_download_not_cancelled(cancellation)?;
        file.flush()
            .await
            .map_err(|e| format!("刷新本地文件失败: {}", e))?;
        drop(file);

        ensure_download_not_cancelled(cancellation)?;
        if let Err(error) = tokio::fs::remove_file(file_path).await {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("替换旧文件失败: {}", error));
            }
        }
        ensure_download_not_cancelled(cancellation)?;
        tokio::fs::rename(&partial_path, file_path)
            .await
            .map_err(|e| format!("完成下载文件写入失败: {}", e))?;
        if let Err(error) = ensure_download_not_cancelled(cancellation) {
            let _ = tokio::fs::remove_file(file_path).await;
            return Err(error);
        }
        on_progress(100);
        Ok(())
    }
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial_path).await;
    }

    result
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
async fn download_song_to_local(
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
fn cancel_download(
    registry: State<'_, DownloadTaskRegistry>,
    task_id: String,
) -> Result<bool, String> {
    let task_id = validate_download_task_id(&task_id)?;
    Ok(registry.cancel(&task_id))
}

/// Metadata entry stored in downloads.json for each downloaded song.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct DownloadMetaEntry {
    filename: String,
    song: serde_json::Value,
    quality: String,
    create_time: f64,
    #[serde(default)]
    size: u64,
}

/// Result returned by resolve_local_playback for offline playback.
#[derive(Clone, serde::Serialize)]
struct ResolvedPlayback {
    filepath: String,
    song: serde_json::Value,
    quality: String,
}

/// Reads the downloads.json sidecar file from the download directory.
fn read_downloads_json(dir: &std::path::Path) -> Vec<DownloadMetaEntry> {
    let path = dir.join("downloads.json");
    if !path.exists() {
        return Vec::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Writes the downloads.json sidecar file.
fn write_downloads_json(dir: &Path, entries: &[DownloadMetaEntry]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建下载目录失败: {}", e))?;
    let path = dir.join("downloads.json");
    let temp_path = dir.join(format!("downloads.json.partial-{}", now_millis()));
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("序列化 downloads.json 失败: {}", e))?;
    std::fs::write(&temp_path, json).map_err(|e| format!("写入 downloads.json 失败: {}", e))?;
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    std::fs::rename(&temp_path, &path).map_err(|e| format!("更新 downloads.json 失败: {}", e))
}

/// Scans the download directory and returns all downloads with metadata.
///
/// Reads downloads.json for song metadata, cross-references with actual files
/// on disk, and removes orphaned entries (files deleted externally).
#[tauri::command]
fn scan_download_dir(
    app_handle: tauri::AppHandle,
    custom_dir: Option<String>,
) -> Result<Vec<DownloadMetaEntry>, String> {
    let dir = resolve_safe_download_dir(&app_handle, custom_dir.as_deref())?;
    cleanup_stale_partials(&dir);

    let mut entries = read_downloads_json(&dir);

    // Retain only entries whose sanitized filename still resolves inside the download directory.
    let before = entries.len();
    entries.retain(|e| {
        verified_existing_download_path(&dir, &e.filename, AUDIO_FILE_EXTENSIONS).is_ok()
    });

    // If entries were removed (files deleted externally or metadata was invalid), update the JSON.
    if entries.len() != before {
        write_downloads_json(&dir, &entries)?;
    }

    // Populate file size from disk metadata.
    for entry in &mut entries {
        if let Ok(path) =
            verified_existing_download_path(&dir, &entry.filename, AUDIO_FILE_EXTENSIONS)
        {
            if let Ok(meta) = std::fs::metadata(path) {
                entry.size = meta.len();
            }
        }
    }

    // Sort by create_time descending (newest first).
    entries.sort_by(|a, b| {
        b.create_time
            .partial_cmp(&a.create_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(entries)
}

/// Saves download metadata to downloads.json after a successful download.
#[tauri::command]
fn save_download_meta(
    app_handle: tauri::AppHandle,
    filename: String,
    song: serde_json::Value,
    quality: String,
    create_time: f64,
    custom_dir: Option<String>,
) -> Result<(), String> {
    let dir = resolve_safe_download_dir(&app_handle, custom_dir.as_deref())?;
    let safe_filename = sanitize_filename(&filename, None, AUDIO_FILE_EXTENSIONS)?;
    let size = verified_existing_download_path(&dir, &safe_filename, AUDIO_FILE_EXTENSIONS)
        .ok()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|meta| meta.len())
        .unwrap_or(0);

    let mut entries = read_downloads_json(&dir);

    // Remove any existing entry with the same filename.
    entries.retain(|e| e.filename != safe_filename);

    entries.push(DownloadMetaEntry {
        filename: safe_filename,
        song,
        quality,
        create_time,
        size,
    });

    write_downloads_json(&dir, &entries)
}

/// Deletes a downloaded file and removes its metadata entry.
#[tauri::command]
fn delete_download_file(
    app_handle: tauri::AppHandle,
    filename: String,
    custom_dir: Option<String>,
) -> Result<(), String> {
    let dir = resolve_safe_download_dir(&app_handle, custom_dir.as_deref())?;
    let safe_filename = sanitize_filename(&filename, None, AUDIO_FILE_EXTENSIONS)?;

    if let Ok(file_path) =
        verified_existing_download_path(&dir, &safe_filename, AUDIO_FILE_EXTENSIONS)
    {
        std::fs::remove_file(&file_path).map_err(|e| format!("删除文件失败: {}", e))?;
    }

    // Remove from downloads.json.
    let mut entries = read_downloads_json(&dir);
    let before = entries.len();
    entries.retain(|e| e.filename != safe_filename);

    if entries.len() != before {
        write_downloads_json(&dir, &entries)?;
    }

    Ok(())
}

/// Resolves a local file path for offline playback.
///
/// Searches downloads.json for a matching song (by ID and source), preferring
/// the requested quality but falling back to any available quality.
/// Returns the filepath, song metadata, and quality if found.
#[tauri::command]
fn resolve_local_playback(
    app_handle: tauri::AppHandle,
    song_id: String,
    source: String,
    quality: Option<String>,
    custom_dir: Option<String>,
) -> Result<Option<ResolvedPlayback>, String> {
    let dir = resolve_safe_download_dir(&app_handle, custom_dir.as_deref())?;
    let entries = read_downloads_json(&dir);

    let mut matches: Vec<&DownloadMetaEntry> = entries
        .iter()
        .filter(|e| {
            if let Some(id) = e.song.get("id").and_then(|v| v.as_str()) {
                id == song_id
            } else if let Some(id) = e.song.get("id").and_then(|v| v.as_i64()) {
                id.to_string() == song_id
            } else {
                false
            }
        })
        .filter(|e| {
            e.song
                .get("source")
                .and_then(|v| v.as_str())
                .is_some_and(|s| s == source)
        })
        .collect();

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
                .map_err(|e| format!("授权本地音频播放失败: {}", e))?;
            return Ok(Some(ResolvedPlayback {
                filepath: file_path.to_string_lossy().to_string(),
                song: entry.song.clone(),
                quality: entry.quality.clone(),
            }));
        }
    }

    Ok(None)
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
async fn relay_player_control(
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

/// Tauri command to open an external URL in the system's default browser.
///
/// Only HTTPS URLs are accepted. Local filesystem paths are handled by
/// `open_download_dir` so renderer input cannot select arbitrary files.
#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
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

#[tauri::command]
async fn open_download_dir(
    app_handle: tauri::AppHandle,
    custom_dir: Option<String>,
) -> Result<(), String> {
    let dir = resolve_safe_download_dir(&app_handle, custom_dir.as_deref())?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tauri command to get the download directory path.
///
/// If `use_default` is `Some(true)`, returns the executable's parent
/// directory (portable mode). Otherwise, returns the OS download directory.
///
/// # Arguments
/// * `app_handle` - Tauri app handle.
/// * `use_default` - If `true`, use the executable's parent directory.
#[tauri::command]
fn get_download_dir(
    app_handle: tauri::AppHandle,
    use_default: Option<bool>,
) -> Result<String, String> {
    resolve_download_dir(&app_handle, use_default.unwrap_or(false))
        .map(|p| p.to_string_lossy().to_string())
}

/// Tauri command to get the default (portable) download directory.
///
/// Returns the executable's parent directory, falling back to the OS
/// download directory if the executable path cannot be determined.
///
/// # Arguments
/// * `app_handle` - Tauri app handle.
#[tauri::command]
fn get_default_download_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    resolve_download_dir(&app_handle, true).map(|p| p.to_string_lossy().to_string())
}

/// Tauri command to open a folder picker dialog for selecting a download directory.
///
/// Wraps the dialog callback in a 5-minute timeout to prevent indefinite
/// blocking if the user never responds.
///
/// # Arguments
/// * `app_handle` - Tauri app handle.
///
/// # Returns
/// `Some(path)` if a folder was selected, `None` if the dialog was cancelled.
#[tauri::command]
async fn select_download_dir(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
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
        Ok(Err(e)) => return Err(format!("对话框通道错误: {}", e)),
        Err(_) => return Err("选择下载目录超时（5分钟）".to_string()),
    };

    if let Some(path) = selected {
        let canonical = canonicalize_dir(PathBuf::from(path))?;
        save_approved_download_dir(&app_handle, &canonical)?;
        Ok(Some(canonical.to_string_lossy().into_owned()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn check_for_update(app_handle: tauri::AppHandle) -> Result<Option<AvailableUpdate>, String> {
    let update = app_handle
        .updater()
        .map_err(|e| format!("初始化更新器失败: {}", e))?
        .check()
        .await
        .map_err(|e| format!("检查更新失败: {}", e))?;

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
async fn download_and_install_update(app_handle: tauri::AppHandle) -> Result<(), String> {
    let update = app_handle
        .updater()
        .map_err(|e| format!("初始化更新器失败: {}", e))?
        .check()
        .await
        .map_err(|e| format!("检查更新失败: {}", e))?
        .ok_or_else(|| "当前没有可安装的更新".to_string())?;

    let progress_handle = app_handle.clone();
    let mut downloaded = 0_u64;
    let _ = app_handle.emit("update-progress", UpdateProgress { progress: 0 });

    update
        .download_and_install(
            move |chunk_length, content_length| {
                downloaded = downloaded.saturating_add(chunk_length as u64);
                let progress = calculate_update_progress(downloaded, content_length);
                let _ = progress_handle.emit("update-progress", UpdateProgress { progress });
            },
            || {},
        )
        .await
        .map_err(|e| format!("下载或安装更新失败: {}", e))?;

    let _ = app_handle.emit("update-progress", UpdateProgress { progress: 100 });
    app_handle.restart()
}

/// Entry point for the Tauri application.
///
/// Sets up the shared HTTP client, shutdown signal channel, tray icon,
/// window event handlers, and starts the local HTTP server.
/// Uses `.build()?.run()` to handle `RunEvent` callbacks for graceful shutdown.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let process_instance = match acquire_process_instance() {
        Some(instance) => instance,
        None => return,
    };

    // Create shutdown signal channel for graceful server shutdown
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    // Bind the local server before the frontend starts so the actual port can
    // be read synchronously through Tauri state, even when 3002 is occupied.
    let server_listener = server::bind_local_listener(3002)
        .expect("Failed to bind local API server to a loopback port");
    let local_server_port = server_listener
        .local_addr()
        .map(|addr| addr.port())
        .expect("Failed to determine local API server port");
    if local_server_port != 3002 {
        log::warn!(
            "Local API port 3002 is unavailable; using 127.0.0.1:{}",
            local_server_port
        );
    }

    // Create shared HTTP client with sensible defaults for API calls.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_max_idle_per_host(20)
        .build()
        .expect("Failed to build HTTP client");

    // Downloads can legitimately take longer than API calls. Avoid a short
    // whole-request timeout; keep connect timeout so broken networks fail fast.
    let download_client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_max_idle_per_host(8)
        .build()
        .expect("Failed to build download HTTP client");

    // Streaming proxy requests must not inherit the API client's 30-second
    // whole-request timeout, otherwise long audio streams can be truncated.
    let proxy_client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .read_timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            let allowed = matches!(url.scheme(), "http" | "https")
                && url
                    .host_str()
                    .is_some_and(crate::api::proxy::is_allowed_host);
            if !allowed {
                return attempt.error("proxy redirect target is not allowed");
            }
            if attempt.previous().len() >= 10 {
                return attempt.error("too many proxy redirects");
            }
            attempt.follow()
        }))
        .pool_max_idle_per_host(20)
        .build()
        .expect("Failed to build streaming proxy HTTP client");

    let lifecycle = AppLifecycleState {
        is_quitting: Arc::new(AtomicBool::new(false)),
        shutdown_tx,
    };
    let window_lifecycle = lifecycle.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(process_instance)
        .manage(lifecycle)
        .manage(LocalServerState {
            port: local_server_port,
        })
        .manage(client.clone())
        .manage(DownloadClient(download_client.clone()))
        .manage(DownloadTaskRegistry::default())
        .invoke_handler(tauri::generate_handler![
            download_song_to_local,
            cancel_download,
            scan_download_dir,
            save_download_meta,
            delete_download_file,
            resolve_local_playback,
            relay_player_control,
            open_external_url,
            open_download_dir,
            get_download_dir,
            get_default_download_dir,
            select_download_dir,
            check_for_update,
            download_and_install_update,
            get_local_server_port,
            log_recommendation_event,
            sync_recommendation_library,
            get_home_recommendations,
            get_similar_songs,
            start_recommendation_job,
            get_recommendation_job,
            get_latest_recommendation_job,
            dismiss_recommendation,
            save_recommendation_feedback,
            rebuild_recommendation_index,
            get_llm_config,
            save_llm_config,
            test_llm_provider,
            clear_recommendation_data,
            quit_app,
            show_desktop_lyric_window,
            hide_desktop_lyric_window
        ])
        .on_window_event(move |window, event| {
            if window.label() == "desktop-lyric" {
                match event {
                    WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                        save_desktop_lyric_bounds(window);
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        save_desktop_lyric_bounds(window);
                        if !window_lifecycle.is_quitting.load(Ordering::SeqCst) {
                            api.prevent_close();
                            let _ = window.hide();
                            let _ = window.emit_to("main", "desktop-lyric-closed", ());
                        }
                    }
                    _ => {}
                }
            }
        })
        .setup(move |app| {
            app.handle().plugin(tauri_plugin_dialog::init())?;

            let recommendation_service =
                RecommendationService::new(app.handle().clone(), client.clone())
                    .map_err(std::io::Error::other)?;
            if let Err(e) = recommendation_service.start_startup_recommendation_job() {
                log::error!("启动智能推荐预热失败: {}", e);
            }
            app.manage(recommendation_service);

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let menu = MenuBuilder::new(app)
                .text("show", "显示 TuneFree")
                .separator()
                .text("quit", "退出 TuneFree")
                .build()?;

            let tray_icon = app.default_window_icon().cloned();
            let mut tray_builder = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("TuneFree")
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "show" => show_main_window(app_handle),
                    "quit" => quit_app_inner(app_handle),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => show_main_window(tray.app_handle()),
                    _ => {}
                });

            if let Some(icon) = tray_icon {
                tray_builder = tray_builder.icon(icon);
            }
            let _ = tray_builder.build(app)?;

            // Start the local Axum web server for resolving APIs
            tauri::async_runtime::spawn(server::start_server(
                app.handle().clone(),
                server::ServerState {
                    api_client: client.clone(),
                    proxy_client: proxy_client.clone(),
                },
                server_listener,
                shutdown_rx,
            ));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<AppLifecycleState>() {
                let _ = state.shutdown_tx.send(true);
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    #[tokio::test]
    async fn recommendation_database_work_runs_on_blocking_pool() {
        let value = run_recommendation_blocking(|| Ok::<_, String>(42))
            .await
            .unwrap();
        assert_eq!(value, 42);
    }

    async fn test_http_response(
        content_length: Option<usize>,
        body: Vec<u8>,
        body_delay: Duration,
    ) -> reqwest::Response {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = socket.read(&mut request).await;

            let content_length_header = content_length
                .map(|size| format!("Content-Length: {}\r\n", size))
                .unwrap_or_default();
            let headers = format!(
                "HTTP/1.1 200 OK\r\n{}Connection: close\r\n\r\n",
                content_length_header
            );
            socket.write_all(headers.as_bytes()).await.unwrap();
            socket.flush().await.unwrap();
            if !body_delay.is_zero() {
                tokio::time::sleep(body_delay).await;
            }
            let _ = socket.write_all(&body).await;
        });

        reqwest::Client::new()
            .get(format!("http://{}/audio", address))
            .send()
            .await
            .unwrap()
    }

    fn temp_download_path(test_name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!(
                "tunefree-download-test-{}-{}-{}",
                test_name,
                std::process::id(),
                now_millis()
            ))
            .join("track.mp3")
    }

    fn assert_no_partial_file(file_path: &Path) {
        let parent = file_path.parent().unwrap();
        let has_partial = std::fs::read_dir(parent)
            .into_iter()
            .flatten()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().contains(".partial-"));
        assert!(!has_partial);
    }

    #[test]
    fn sanitize_filename_rejects_path_traversal() {
        assert!(sanitize_filename("../evil.mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).is_err());
        assert!(sanitize_filename("..\\evil.mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).is_err());
        assert!(
            sanitize_filename("C:\\Windows\\win.ini", Some("mp3"), AUDIO_FILE_EXTENSIONS).is_err()
        );
    }

    #[test]
    fn sanitize_filename_keeps_apostrophes_and_handles_reserved_names() {
        assert_eq!(
            sanitize_filename("Rock 'n' Roll.mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap(),
            "Rock 'n' Roll.mp3"
        );
        assert_eq!(
            sanitize_filename("CON.mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap(),
            "_CON.mp3"
        );
    }

    #[test]
    fn download_progress_serializes_task_id_for_the_frontend() {
        let payload = serde_json::to_value(DownloadProgress {
            task_id: "download:test".to_string(),
            url: "https://example.com/audio.mp3".to_string(),
            progress: 42,
        })
        .unwrap();

        assert_eq!(payload["taskId"], "download:test");
        assert!(payload.get("task_id").is_none());
        assert_eq!(payload["progress"], 42);
    }

    #[test]
    fn download_limits_and_task_ids_are_validated() {
        assert!(validate_download_task_id("download:valid-id_1").is_ok());
        assert!(validate_download_task_id("").is_err());
        assert!(validate_download_task_id("download:invalid/id").is_err());
        assert!(validate_download_size(MAX_AUDIO_DOWNLOAD_BYTES, MAX_AUDIO_DOWNLOAD_BYTES).is_ok());
        assert!(
            validate_download_size(MAX_AUDIO_DOWNLOAD_BYTES + 1, MAX_AUDIO_DOWNLOAD_BYTES).is_err()
        );
        assert!(checked_downloaded_size(4, 2, 5).is_err());
    }

    #[test]
    fn download_task_registry_registers_cancels_and_finishes_tasks() {
        let registry = DownloadTaskRegistry::default();
        let cancellation = registry.register("download:test").unwrap();

        assert!(registry.register("download:test").is_err());
        assert!(!cancellation.is_cancelled());
        assert!(registry.cancel("download:test"));
        assert!(cancellation.is_cancelled());
        registry.finish("download:test");
        assert!(!registry.cancel("download:test"));
    }

    #[tokio::test]
    async fn persist_download_response_writes_and_renames_the_partial_file() {
        let file_path = temp_download_path("success");
        let response = test_http_response(Some(5), b"audio".to_vec(), Duration::ZERO).await;
        let mut progress = Vec::new();
        let cancellation = DownloadCancellation::default();

        persist_download_response(
            response,
            &file_path,
            Duration::from_secs(1),
            16,
            &cancellation,
            |value| progress.push(value),
        )
        .await
        .unwrap();

        assert_eq!(tokio::fs::read(&file_path).await.unwrap(), b"audio");
        assert_eq!(progress.first(), Some(&0));
        assert_eq!(progress.last(), Some(&100));
        assert_no_partial_file(&file_path);
        let _ = tokio::fs::remove_dir_all(file_path.parent().unwrap()).await;
    }

    #[tokio::test]
    async fn persist_download_response_removes_partial_when_stream_exceeds_limit() {
        let file_path = temp_download_path("size-limit");
        let response = test_http_response(None, b"too-large".to_vec(), Duration::ZERO).await;
        let cancellation = DownloadCancellation::default();

        let error = persist_download_response(
            response,
            &file_path,
            Duration::from_secs(1),
            4,
            &cancellation,
            |_| {},
        )
        .await
        .unwrap_err();

        assert!(error.contains("大小限制"));
        assert!(!file_path.exists());
        assert_no_partial_file(&file_path);
        let _ = tokio::fs::remove_dir_all(file_path.parent().unwrap()).await;
    }

    #[tokio::test]
    async fn persist_download_response_removes_partial_after_idle_timeout() {
        let file_path = temp_download_path("idle-timeout");
        let response = test_http_response(Some(1), b"x".to_vec(), Duration::from_millis(100)).await;
        let cancellation = DownloadCancellation::default();

        let error = persist_download_response(
            response,
            &file_path,
            Duration::from_millis(10),
            16,
            &cancellation,
            |_| {},
        )
        .await
        .unwrap_err();

        assert!(error.contains("读取超时"));
        assert!(!file_path.exists());
        assert_no_partial_file(&file_path);
        let _ = tokio::fs::remove_dir_all(file_path.parent().unwrap()).await;
    }

    #[tokio::test]
    async fn persist_download_response_removes_partial_after_cancellation() {
        let file_path = temp_download_path("cancelled");
        let response =
            test_http_response(Some(5), b"audio".to_vec(), Duration::from_millis(100)).await;
        let cancellation = Arc::new(DownloadCancellation::default());
        let cancellation_trigger = cancellation.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            cancellation_trigger.cancel();
        });

        let error = persist_download_response(
            response,
            &file_path,
            Duration::from_secs(1),
            16,
            &cancellation,
            |_| {},
        )
        .await
        .unwrap_err();

        assert!(error.contains("已取消"));
        assert!(!file_path.exists());
        assert_no_partial_file(&file_path);
        let _ = tokio::fs::remove_dir_all(file_path.parent().unwrap()).await;
    }

    #[test]
    fn update_progress_is_bounded_until_signature_verification_finishes() {
        assert_eq!(calculate_update_progress(0, Some(100)), 0);
        assert_eq!(calculate_update_progress(50, Some(100)), 50);
        assert_eq!(calculate_update_progress(100, Some(100)), 99);
        assert_eq!(calculate_update_progress(200, Some(100)), 99);
        assert_eq!(calculate_update_progress(50, None), 0);
        assert_eq!(calculate_update_progress(50, Some(0)), 0);
    }

    #[test]
    fn external_url_validation_rejects_non_https_schemes() {
        assert!(validate_external_url("https://tauri.app/").is_ok());
        assert!(validate_external_url("file:///C:/Windows/win.ini").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("http://example.com/").is_err());
    }

    #[test]
    fn safe_join_keeps_files_inside_download_dir() {
        let dir = std::env::temp_dir().join(format!(
            "tunefree-safe-join-test-{}-{}",
            std::process::id(),
            now_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let (path, filename) = safe_join_download_dir(
            &dir,
            "Artist - Song.mp3",
            Some("mp3"),
            AUDIO_FILE_EXTENSIONS,
        )
        .unwrap();
        assert_eq!(filename, "Artist - Song.mp3");
        assert_eq!(
            path.parent().unwrap(),
            canonicalize_dir(dir.clone()).unwrap().as_path()
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
