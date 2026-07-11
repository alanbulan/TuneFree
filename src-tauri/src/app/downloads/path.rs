use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Resolves the download directory for saving files.
///
/// If `use_default` is `true`, returns the executable's parent directory
/// (portable mode). Otherwise, returns the OS download directory.
///
/// Replaces the previous `unwrap()` calls with proper error handling.
pub(crate) fn resolve_download_dir(
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

pub(crate) const AUDIO_FILE_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "m4a", "aac", "ogg"];
pub(crate) const DOWNLOAD_DIR_CONFIG_FILE: &str = "download-dir.txt";
pub(crate) const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const MAX_AUDIO_DOWNLOAD_BYTES: u64 = 1024 * 1024 * 1024;
pub(crate) const MAX_DOWNLOAD_TASK_ID_LEN: usize = 128;

pub(crate) fn validate_download_task_id(task_id: &str) -> Result<String, String> {
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

pub(crate) fn validate_download_size(size: u64, max_bytes: u64) -> Result<(), String> {
    if size > max_bytes {
        return Err(format!(
            "下载文件超过大小限制（最大 {} MiB）",
            max_bytes / 1024 / 1024
        ));
    }
    Ok(())
}

pub(crate) fn checked_downloaded_size(
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

pub(crate) fn download_dir_config_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法解析应用配置目录: {}", e))?;
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("无法创建应用配置目录: {}", e))?;
    Ok(app_dir.join(DOWNLOAD_DIR_CONFIG_FILE))
}

pub(crate) fn save_approved_download_dir(
    app_handle: &tauri::AppHandle,
    dir: &Path,
) -> Result<(), String> {
    let path = download_dir_config_path(app_handle)?;
    std::fs::write(path, dir.to_string_lossy().as_ref())
        .map_err(|e| format!("保存下载目录配置失败: {}", e))
}

pub(crate) fn read_approved_download_dir(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let path = download_dir_config_path(app_handle).ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    PathBuf::from(trimmed).canonicalize().ok()
}

pub(crate) fn canonicalize_dir(path: PathBuf) -> Result<PathBuf, String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("无法创建下载目录: {}", e))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("无法解析下载目录: {}", e))?;
    if !canonical.is_dir() {
        return Err("下载路径不是有效目录".to_string());
    }
    Ok(canonical)
}

pub(crate) fn resolve_safe_download_dir(
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
) -> Result<(PathBuf, String), String> {
    let canonical_dir = canonicalize_dir(dir.to_path_buf())?;
    let safe_filename = sanitize_filename(filename, fallback_ext, allowed_exts)?;
    let path = canonical_dir.join(&safe_filename);
    if path.parent() != Some(canonical_dir.as_path()) {
        return Err("文件路径越界".to_string());
    }
    Ok((path, safe_filename))
}

pub(crate) fn unique_download_path(
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

pub(crate) fn verified_existing_download_path(
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

pub(crate) fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub(crate) fn partial_path_for(file_path: &Path) -> Result<PathBuf, String> {
    let filename = file_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "无法生成临时下载文件名".to_string())?;
    Ok(file_path.with_file_name(format!("{}.partial-{}", filename, now_millis())))
}

pub(crate) fn cleanup_stale_partials(dir: &Path) {
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

#[cfg(test)]
#[path = "path_tests.rs"]
mod tests;
