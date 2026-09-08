use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

use crate::app::error::{CommandError, CommandResult, ErrorCode};

pub(crate) const AUDIO_FILE_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "m4a", "aac", "ogg"];
pub(crate) const DOWNLOAD_DIR_CONFIG_FILE: &str = "download-dir.txt";
pub(crate) const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const MAX_AUDIO_DOWNLOAD_BYTES: u64 = 1024 * 1024 * 1024;
pub(crate) const MAX_DOWNLOAD_TASK_ID_LEN: usize = 128;
const MAX_FILENAME_STEM_CHARS: usize = 160;
/// Marker file next to the executable that opts into portable mode.
pub(crate) const PORTABLE_MARKER_FILE: &str = "portable.txt";
/// Subdirectory of the OS download folder used by installed (non-portable) builds.
pub(crate) const DOWNLOAD_SUBDIR_NAME: &str = "TuneFree";
/// Partial files younger than this are never touched by the cleanup pass, so
/// an in-flight transfer can not lose its temp file to a concurrent cleanup.
pub(crate) const STALE_PARTIAL_MAX_AGE: Duration = Duration::from_secs(60 * 60);

pub(crate) fn invalid_dir(message: impl Into<String>) -> CommandError {
    CommandError::new(ErrorCode::DownloadDirInvalid, message)
}

pub(crate) fn download_failed(message: impl Into<String>) -> CommandError {
    CommandError::new(ErrorCode::DownloadFailed, message)
}

/// Strips the Windows extended-length prefix for user-facing display.
pub(crate) fn display_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
}

/// Returns true when a portable marker file sits next to the executable.
pub(crate) fn is_portable_install(exe_dir: &Path) -> bool {
    exe_dir.join(PORTABLE_MARKER_FILE).is_file()
}

/// Picks the default download directory.
///
/// Portable installs (marker file next to the exe) keep files beside the
/// executable; installed builds use `<OS downloads>/TuneFree` so an NSIS
/// uninstall or update can never wipe the user's music.
pub(crate) fn choose_default_download_dir(
    exe_dir: Option<PathBuf>,
    os_download_dir: Option<PathBuf>,
) -> CommandResult<PathBuf> {
    if let Some(dir) = exe_dir {
        if is_portable_install(&dir) {
            return Ok(dir);
        }
    }
    os_download_dir
        .map(|dir| dir.join(DOWNLOAD_SUBDIR_NAME))
        .ok_or_else(|| invalid_dir("无法解析系统下载目录"))
}

/// Resolves the default download directory for this installation.
pub(crate) fn resolve_default_download_dir(
    app_handle: &tauri::AppHandle,
) -> CommandResult<PathBuf> {
    if let Some(dir) = crate::app::smoke_data_dir() {
        return Ok(dir.join("downloads"));
    }
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    let os_download_dir = app_handle.path().download_dir().ok();
    choose_default_download_dir(exe_dir, os_download_dir)
}

pub(crate) fn validate_download_task_id(task_id: &str) -> CommandResult<String> {
    let task_id = task_id.trim();
    if task_id.is_empty() || task_id.len() > MAX_DOWNLOAD_TASK_ID_LEN {
        return Err(CommandError::invalid_argument("下载任务 ID 无效"));
    }
    if !task_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'-' | b'_'))
    {
        return Err(CommandError::invalid_argument("下载任务 ID 包含非法字符"));
    }
    Ok(task_id.to_string())
}

pub(crate) fn validate_download_size(size: u64, max_bytes: u64) -> CommandResult<()> {
    if size > max_bytes {
        return Err(download_failed(format!(
            "下载文件超过大小限制（最大 {} MiB）",
            max_bytes / 1024 / 1024
        )));
    }
    Ok(())
}

pub(crate) fn checked_downloaded_size(
    downloaded: u64,
    chunk_size: usize,
    max_bytes: u64,
) -> CommandResult<u64> {
    let next = downloaded
        .checked_add(chunk_size as u64)
        .ok_or_else(|| download_failed("下载文件大小溢出"))?;
    validate_download_size(next, max_bytes)?;
    Ok(next)
}

pub(crate) fn download_dir_config_path(app_handle: &tauri::AppHandle) -> CommandResult<PathBuf> {
    let app_dir = match crate::app::smoke_data_dir() {
        Some(dir) => dir.join("config"),
        None => app_handle
            .path()
            .app_config_dir()
            .map_err(|e| CommandError::io(format!("无法解析应用配置目录: {}", e)))?,
    };
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| CommandError::io(format!("无法创建应用配置目录: {}", e)))?;
    Ok(app_dir.join(DOWNLOAD_DIR_CONFIG_FILE))
}

/// Writes the approved directory into the given config file.
pub(crate) fn write_download_dir_config(config_path: &Path, dir: &Path) -> CommandResult<()> {
    std::fs::write(config_path, dir.to_string_lossy().as_ref())
        .map_err(|e| CommandError::io(format!("保存下载目录配置失败: {}", e)))
}

/// Deletes the given config file.
///
/// A missing file is already the desired end state, so it is not an error.
pub(crate) fn remove_download_dir_config(config_path: &Path) -> CommandResult<()> {
    match std::fs::remove_file(config_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::io(format!("重置下载目录配置失败: {}", error))),
    }
}

/// Reads the approved directory from the given config file; an absent, empty
/// or unreadable file means "no approval on record".
pub(crate) fn read_download_dir_config(config_path: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

pub(crate) fn save_approved_download_dir(
    app_handle: &tauri::AppHandle,
    dir: &Path,
) -> CommandResult<()> {
    write_download_dir_config(&download_dir_config_path(app_handle)?, dir)
}

/// Clears the recorded approval so the default directory takes over again.
pub(crate) fn clear_approved_download_dir(app_handle: &tauri::AppHandle) -> CommandResult<()> {
    remove_download_dir_config(&download_dir_config_path(app_handle)?)
}

pub(crate) fn read_approved_download_dir(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    read_download_dir_config(&download_dir_config_path(app_handle).ok()?)
}

pub(crate) fn canonicalize_dir(path: PathBuf) -> CommandResult<PathBuf> {
    std::fs::create_dir_all(&path).map_err(|e| invalid_dir(format!("无法创建下载目录: {}", e)))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| invalid_dir(format!("无法解析下载目录: {}", e)))?;
    if !canonical.is_dir() {
        return Err(invalid_dir("下载路径不是有效目录"));
    }
    Ok(canonical)
}

/// Resolves the effective download directory.
///
/// The backend is the single owner of this decision: the user-approved
/// directory when one is recorded, otherwise the default directory. The
/// renderer never passes a directory in.
pub(crate) fn resolve_safe_download_dir(app_handle: &tauri::AppHandle) -> CommandResult<PathBuf> {
    if let Some(approved) = read_approved_download_dir(app_handle) {
        match canonicalize_dir(approved.clone()) {
            Ok(dir) => return Ok(dir),
            Err(error) => log::warn!(
                "已授权下载目录不可用({}), 回退默认目录: {}",
                approved.display(),
                error
            ),
        }
    }
    canonicalize_dir(resolve_default_download_dir(app_handle)?)
}

pub(crate) fn has_windows_drive_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

pub(crate) fn is_windows_reserved_basename(stem: &str) -> bool {
    let upper = stem.trim_matches('_').to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
        || upper
            .strip_prefix("LPT")
            .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
}

pub(crate) fn sanitize_filename(
    input: &str,
    fallback_ext: Option<&str>,
    allowed_exts: &[&str],
) -> CommandResult<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(CommandError::invalid_argument("文件名不能为空"));
    }
    if trimmed.contains('/') || trimmed.contains('\\') || Path::new(trimmed).is_absolute() {
        return Err(CommandError::invalid_argument("文件名不能包含路径"));
    }
    if has_windows_drive_prefix(trimmed) {
        return Err(CommandError::invalid_argument(
            "文件名不能包含 Windows 盘符前缀",
        ));
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
        return Err(CommandError::invalid_argument("文件名不能为空"));
    }

    let (mut stem, ext) = match sanitized.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => {
            (stem.to_string(), ext.to_ascii_lowercase())
        }
        _ => {
            let fallback =
                fallback_ext.ok_or_else(|| CommandError::invalid_argument("文件名缺少扩展名"))?;
            (sanitized, fallback.to_ascii_lowercase())
        }
    };

    if !allowed_exts.iter().any(|allowed| *allowed == ext) {
        return Err(CommandError::invalid_argument(format!(
            "不支持的文件扩展名: {}",
            ext
        )));
    }

    stem = stem.trim().trim_end_matches(&[' ', '.'][..]).to_string();
    if stem.is_empty() || stem == "." || stem == ".." {
        return Err(CommandError::invalid_argument("文件名不能为空"));
    }
    if is_windows_reserved_basename(&stem) {
        stem = format!("_{}", stem);
    }

    if stem.chars().count() > MAX_FILENAME_STEM_CHARS {
        stem = stem.chars().take(MAX_FILENAME_STEM_CHARS).collect();
    }

    Ok(format!("{}.{}", stem, ext))
}

pub(crate) fn split_filename(filename: &str) -> (String, String) {
    filename
        .rsplit_once('.')
        .map(|(stem, ext)| (stem.to_string(), ext.to_string()))
        .unwrap_or_else(|| (filename.to_string(), "".to_string()))
}

pub(crate) fn safe_join_download_dir(
    dir: &Path,
    filename: &str,
    fallback_ext: Option<&str>,
    allowed_exts: &[&str],
) -> CommandResult<(PathBuf, String)> {
    let canonical_dir = canonicalize_dir(dir.to_path_buf())?;
    let safe_filename = sanitize_filename(filename, fallback_ext, allowed_exts)?;
    let path = canonical_dir.join(&safe_filename);
    if path.parent() != Some(canonical_dir.as_path()) {
        return Err(CommandError::invalid_argument("文件路径越界"));
    }
    Ok((path, safe_filename))
}

pub(crate) fn unique_download_path(
    dir: &Path,
    filename: &str,
    fallback_ext: Option<&str>,
    allowed_exts: &[&str],
) -> CommandResult<(PathBuf, String)> {
    let (initial_path, safe_filename) =
        safe_join_download_dir(dir, filename, fallback_ext, allowed_exts)?;
    if !initial_path.exists() {
        return Ok((initial_path, safe_filename));
    }

    let (stem, ext) = split_filename(&safe_filename);
    for counter in 1..10_000 {
        let suffix = format!(" ({counter})");
        // 先给编号留出长度，否则后续文件名清理会把编号再次截掉。
        let numbered_stem: String = stem
            .chars()
            .take(MAX_FILENAME_STEM_CHARS - suffix.chars().count())
            .collect();
        let candidate_filename = format!("{numbered_stem}{suffix}.{ext}");
        let (candidate, candidate_filename) =
            safe_join_download_dir(dir, &candidate_filename, fallback_ext, allowed_exts)?;
        if !candidate.exists() {
            return Ok((candidate, candidate_filename));
        }
    }

    Err(CommandError::io("无法生成不重复的文件名"))
}

pub(crate) fn verified_existing_download_path(
    dir: &Path,
    filename: &str,
    allowed_exts: &[&str],
) -> CommandResult<PathBuf> {
    let (path, _) = safe_join_download_dir(dir, filename, None, allowed_exts)?;
    if !path
        .try_exists()
        .map_err(|error| CommandError::io(format!("无法读取本地文件: {}", error)))?
    {
        return Err(CommandError::not_found("文件不存在"));
    }
    let canonical_dir = canonicalize_dir(dir.to_path_buf())?;
    let canonical_file = path.canonicalize().map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => CommandError::not_found("文件不存在"),
        _ => CommandError::io(format!("无法解析本地文件: {}", error)),
    })?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err(CommandError::invalid_argument("文件路径越界"));
    }
    Ok(canonical_file)
}

pub(crate) fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub(crate) fn partial_path_for(file_path: &Path) -> CommandResult<PathBuf> {
    let filename = file_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| CommandError::internal("无法生成临时下载文件名"))?;
    Ok(file_path.with_file_name(format!("{}.partial-{}", filename, now_millis())))
}

/// Returns true when a partial file's mtime proves it is older than
/// [`STALE_PARTIAL_MAX_AGE`]. An unknown or future mtime keeps the file.
pub(crate) fn is_stale_partial(modified: Option<SystemTime>, now: SystemTime) -> bool {
    modified
        .and_then(|time| now.duration_since(time).ok())
        .is_some_and(|age| age >= STALE_PARTIAL_MAX_AGE)
}

/// Removes abandoned partial files from the download directory.
///
/// Only files that are provably old AND not owned by an in-flight download
/// (per `active_partials`) are deleted; both guards must agree because on
/// Windows deleting an open file silently breaks the final commit rename.
pub(crate) fn cleanup_stale_partials(dir: &Path, active_partials: &HashSet<PathBuf>) {
    cleanup_stale_partials_at(dir, active_partials, SystemTime::now());
}

pub(crate) fn cleanup_stale_partials_at(
    dir: &Path,
    active_partials: &HashSet<PathBuf>,
    now: SystemTime,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !name.contains(".partial-") || active_partials.contains(&path) {
            continue;
        }
        let modified = entry.metadata().ok().and_then(|meta| meta.modified().ok());
        if is_stale_partial(modified, now) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg(test)]
#[path = "path_tests.rs"]
mod tests;

#[cfg(all(test, windows))]
#[path = "__tests__/path_boundaries.rs"]
mod boundary_tests;
