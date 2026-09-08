use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::SystemTime;

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
    index: Arc<parking_lot::Mutex<Option<DownloadIndex>>>,
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

#[derive(PartialEq, Eq)]
struct SidecarStamp {
    modified: Option<SystemTime>,
    len: u64,
}

struct DownloadIndex {
    dir: PathBuf,
    stamp: Option<SidecarStamp>,
    songs: HashMap<(String, String), Vec<DownloadMetaEntry>>,
}

fn sidecar_stamp(dir: &Path) -> CommandResult<Option<SidecarStamp>> {
    match std::fs::metadata(dir.join("downloads.json")) {
        Ok(meta) => Ok(Some(SidecarStamp {
            modified: meta.modified().ok(),
            len: meta.len(),
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(CommandError::io(format!("读取下载记录属性失败: {}", error))),
    }
}

impl DownloadMetaStore {
    pub(crate) fn invalidate(&self) {
        *self.index.lock() = None;
    }

    pub(crate) fn matching_entries(
        &self,
        dir: &Path,
        song_id: &str,
        source: &str,
    ) -> CommandResult<Vec<DownloadMetaEntry>> {
        self.with_lock(|| {
            let stamp = sidecar_stamp(dir)?;
            let mut cached = self.index.lock();
            if cached
                .as_ref()
                .is_none_or(|index| index.dir != dir || index.stamp != stamp)
            {
                let mut songs: HashMap<(String, String), Vec<DownloadMetaEntry>> = HashMap::new();
                for entry in read_downloads_json(dir)? {
                    let Some(source) = entry.song.get("source").and_then(|value| value.as_str())
                    else {
                        continue;
                    };
                    let Some(id) = entry.song.get("id") else {
                        continue;
                    };
                    let id = match id {
                        serde_json::Value::String(id) => id.clone(),
                        serde_json::Value::Number(id) => id.to_string(),
                        _ => continue,
                    };
                    songs
                        .entry((source.to_string(), id))
                        .or_default()
                        .push(entry);
                }
                *cached = Some(DownloadIndex {
                    dir: dir.to_path_buf(),
                    stamp,
                    songs,
                });
            }
            Ok(cached
                .as_ref()
                .and_then(|index| index.songs.get(&(source.to_string(), song_id.to_string())))
                .cloned()
                .unwrap_or_default())
        })
    }
}

/// 缺失记录表示空曲库；读取或解析失败必须上报，不能覆盖为一个空列表。
pub(crate) fn read_downloads_json(dir: &Path) -> CommandResult<Vec<DownloadMetaEntry>> {
    let text = match std::fs::read_to_string(dir.join("downloads.json")) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(CommandError::io(format!("读取下载记录失败: {}", error))),
    };
    serde_json::from_str(&text)
        .map_err(|error| CommandError::io(format!("下载记录格式损坏，原文件已保留: {}", error)))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadMetadataInput {
    pub(crate) song: serde_json::Value,
    pub(crate) quality: String,
}

impl DownloadMetadataInput {
    pub(crate) fn validate(&self) -> CommandResult<()> {
        let valid_id = self
            .song
            .get("id")
            .is_some_and(|id| id.is_string() || id.is_number());
        let valid_source = self
            .song
            .get("source")
            .and_then(|value| value.as_str())
            .is_some_and(|s| !s.is_empty());
        if !valid_id
            || !valid_source
            || !matches!(
                self.quality.as_str(),
                "128k" | "320k" | "flac" | "flac24bit"
            )
        {
            return Err(CommandError::invalid_argument("下载歌曲身份或音质无效"));
        }
        Ok(())
    }
}

pub(super) fn save_download_metadata(
    dir: &Path,
    store: &DownloadMetaStore,
    filename: String,
    metadata: DownloadMetadataInput,
) -> CommandResult<()> {
    use super::path::{verified_existing_download_path, AUDIO_FILE_EXTENSIONS};
    let path = verified_existing_download_path(dir, &filename, AUDIO_FILE_EXTENSIONS)?;
    let size = std::fs::metadata(path)?.len();
    store.with_lock(|| {
        let mut entries = read_downloads_json(dir)?;
        entries.retain(|entry| entry.filename != filename);
        entries.push(DownloadMetaEntry {
            filename,
            song: metadata.song,
            quality: metadata.quality,
            create_time: now_millis() as f64,
            size,
        });
        write_downloads_json(dir, &entries)?;
        store.invalidate();
        Ok(())
    })
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

#[cfg(all(test, windows))]
#[path = "__tests__/meta_boundaries.rs"]
mod boundary_tests;
