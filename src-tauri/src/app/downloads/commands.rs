use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::path::{
    canonicalize_dir, cleanup_stale_partials, now_millis, resolve_download_dir,
    resolve_safe_download_dir, sanitize_filename, save_approved_download_dir,
    verified_existing_download_path, AUDIO_FILE_EXTENSIONS,
};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct DownloadMetaEntry {
    filename: String,
    song: serde_json::Value,
    quality: String,
    create_time: f64,
    #[serde(default)]
    size: u64,
}

/// Result returned by resolve_local_playback for offline playback.
#[derive(Clone, serde::Serialize)]
pub(crate) struct ResolvedPlayback {
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
pub(crate) fn scan_download_dir(
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
pub(crate) fn save_download_meta(
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
pub(crate) fn delete_download_file(
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
pub(crate) fn resolve_local_playback(
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
#[tauri::command]
pub(crate) async fn open_download_dir(
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
pub(crate) fn get_download_dir(
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
pub(crate) fn get_default_download_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
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
pub(crate) async fn select_download_dir(
    app_handle: tauri::AppHandle,
) -> Result<Option<String>, String> {
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
