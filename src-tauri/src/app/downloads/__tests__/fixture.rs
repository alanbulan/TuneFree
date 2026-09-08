use super::meta::{DownloadMetaEntry, DownloadMetaStore};
use super::path::{download_dir_config_path, save_approved_download_dir};
use crate::test_support::{app, TempDir};
use serde_json::json;
use tauri::Manager;

pub(super) struct Downloads {
    pub(super) app: tauri::App,
    pub(super) dir: TempDir,
}

impl Downloads {
    pub(super) fn new() -> Self {
        let app = app();
        let dir = TempDir::new();
        app.manage(DownloadMetaStore::default());
        save_approved_download_dir(app.handle(), &dir.0).unwrap();
        Self { app, dir }
    }

    pub(super) fn seed(
        &self,
        filename: &str,
        quality: &str,
        time: f64,
        bytes: &[u8],
    ) -> DownloadMetaEntry {
        std::fs::write(self.dir.0.join(filename), bytes).unwrap();
        DownloadMetaEntry {
            filename: filename.into(),
            song: json!({"id":"1","source":"qq","name":"歌曲"}),
            quality: quality.into(),
            create_time: time,
            size: 0,
        }
    }
}

impl Drop for Downloads {
    fn drop(&mut self) {
        let config = download_dir_config_path(self.app.handle()).unwrap();
        let dir = config.parent().unwrap();
        assert_eq!(
            dir.file_name().unwrap().to_string_lossy(),
            self.app.config().identifier
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
