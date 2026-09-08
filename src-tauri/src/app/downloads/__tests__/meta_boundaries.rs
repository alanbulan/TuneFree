use super::*;
use crate::app::error::ErrorCode;
use crate::test_support::TempDir;
use serde_json::json;
use std::os::windows::fs::OpenOptionsExt;

fn entry(song: serde_json::Value) -> DownloadMetaEntry {
    DownloadMetaEntry {
        filename: "song.mp3".into(),
        song,
        quality: "128k".into(),
        create_time: 1.0,
        size: 10,
    }
}

#[test]
fn shared_fallback_store_reloads_valid_entries_and_skips_incomplete_legacy_identities() {
    let app = crate::test_support::app();
    let directory = TempDir::new();
    let first = DownloadMetaStore::resolve(app.handle());
    let second = DownloadMetaStore::resolve(app.handle());
    write_downloads_json(
        &directory.0,
        &[
            entry(json!({"source":"qq","id":1})),
            entry(json!({"id":"1"})),
            entry(json!({"source":"qq"})),
            entry(json!({"source":"qq","id":false})),
        ],
    )
    .unwrap();
    assert_eq!(
        first
            .matching_entries(&directory.0, "1", "qq")
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        second
            .matching_entries(&directory.0, "1", "qq")
            .unwrap()
            .len(),
        1
    );
    assert!(second
        .matching_entries(&directory.0, "false", "qq")
        .unwrap()
        .is_empty());
    write_downloads_json(&directory.0, &[]).unwrap();
    first.invalidate();
    assert!(second
        .matching_entries(&directory.0, "1", "qq")
        .unwrap()
        .is_empty());
    assert_eq!(
        sidecar_stamp(Path::new("\0")).err().unwrap().code,
        ErrorCode::Io
    );
}

#[test]
fn locked_metadata_cannot_be_read_as_an_empty_library_or_overwritten_by_a_partial_file() {
    let directory = TempDir::new();
    write_downloads_json(&directory.0, &[entry(json!({"source":"qq","id":1}))]).unwrap();
    let path = directory.0.join("downloads.json");
    let original = std::fs::read(&path).unwrap();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    assert_eq!(
        read_downloads_json(&directory.0).err().unwrap().code,
        ErrorCode::Io
    );
    drop(lock);
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .unwrap();
    let error = write_downloads_json(&directory.0, &[]).unwrap_err();
    assert_eq!(error.code, ErrorCode::Io);
    assert!(error.message.contains("更新 downloads.json"));
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 1);
    drop(lock);
}
