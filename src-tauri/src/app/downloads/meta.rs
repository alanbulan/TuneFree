use std::path::Path;
use std::sync::{Arc, OnceLock};

use tauri::Manager;

use crate::app::error::{CommandError, CommandResult};

use super::path::now_millis;

/// A single record in the downloads.json sidecar file.
///
/// Serialized in camelCase to match the frontend contract. `create_time`
/// additionally accepts the legacy snake_case spelling written by older
/// versions so existing download libraries keep loading.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadMetaEntry {
    pub(crate) filename: String,
    pub(crate) song: serde_json::Value,
    pub(crate) quality: String,
    #[serde(alias = "create_time")]
    pub(crate) create_time: f64,
    #[serde(default)]
    pub(crate) size: u64,
}

/// Serializes every read-modify-write cycle over downloads.json so concurrent
/// async commands can no longer interleave and drop each other's entries.
#[derive(Clone, Default)]
pub(crate) struct DownloadMetaStore {
    lock: Arc<parking_lot::Mutex<()>>,
}

impl DownloadMetaStore {
    /// Returns the shared store: the managed instance when bootstrap
    /// registered one, otherwise a process-wide fallback so the lock still
    /// covers every caller. Both paths yield one lock per process.
    pub(crate) fn resolve(app_handle: &tauri::AppHandle) -> Self {
        if let Some(state) = app_handle.try_state::<DownloadMetaStore>() {
            return state.inner().clone();
        }
        static FALLBACK: OnceLock<DownloadMetaStore> = OnceLock::new();
        FALLBACK.get_or_init(DownloadMetaStore::default).clone()
    }

    pub(crate) fn with_lock<T>(&self, operation: impl FnOnce() -> T) -> T {
        let _guard = self.lock.lock();
        operation()
    }
}

/// Reads the downloads.json sidecar file from the download directory.
pub(crate) fn read_downloads_json(dir: &Path) -> Vec<DownloadMetaEntry> {
    let path = dir.join("downloads.json");
    if !path.exists() {
        return Vec::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Writes the downloads.json sidecar file via a temp file + rename.
pub(crate) fn write_downloads_json(dir: &Path, entries: &[DownloadMetaEntry]) -> CommandResult<()> {
    std::fs::create_dir_all(dir)
        .map_err(|e| CommandError::io(format!("创建下载目录失败: {}", e)))?;
    let path = dir.join("downloads.json");
    let temp_path = dir.join(format!("downloads.json.partial-{}", now_millis()));
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| CommandError::internal(format!("序列化 downloads.json 失败: {}", e)))?;
    std::fs::write(&temp_path, json)
        .map_err(|e| CommandError::io(format!("写入 downloads.json 失败: {}", e)))?;
    // `rename` replaces the destination on Windows and Unix alike, so the old
    // sidecar survives intact unless the new one fully lands.
    std::fs::rename(&temp_path, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        CommandError::io(format!("更新 downloads.json 失败: {}", e))
    })
}

#[cfg(test)]
#[path = "meta_tests.rs"]
mod tests;
