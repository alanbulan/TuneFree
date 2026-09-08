use super::*;

fn sample_entry() -> DownloadMetaEntry {
    DownloadMetaEntry {
        filename: "Artist - Song.mp3".to_string(),
        song: serde_json::json!({ "id": "1", "source": "netease" }),
        quality: "320k".to_string(),
        create_time: 1_700_000_000_000.0,
        size: 42,
    }
}

#[test]
fn download_meta_entry_serializes_camel_case() {
    let value = serde_json::to_value(sample_entry()).unwrap();
    assert_eq!(value["createTime"], 1_700_000_000_000.0);
    assert!(value.get("create_time").is_none());
    assert_eq!(value["size"], 42);
}

#[test]
fn download_meta_entry_reads_legacy_snake_case_files() {
    let legacy = r#"[{
        "filename": "Artist - Song.mp3",
        "song": { "id": "1" },
        "quality": "320k",
        "create_time": 123.5
    }]"#;
    let entries: Vec<DownloadMetaEntry> = serde_json::from_str(legacy).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].create_time, 123.5);
    assert_eq!(entries[0].size, 0);
}

#[test]
fn download_meta_entry_reads_camel_case_files() {
    let current = r#"[{
        "filename": "Artist - Song.mp3",
        "song": { "id": "1" },
        "quality": "320k",
        "createTime": 456.5,
        "size": 7
    }]"#;
    let entries: Vec<DownloadMetaEntry> = serde_json::from_str(current).unwrap();
    assert_eq!(entries[0].create_time, 456.5);
    assert_eq!(entries[0].size, 7);
}

#[test]
fn write_and_read_downloads_json_round_trip() {
    let dir = std::env::temp_dir().join(format!(
        "tunefree-meta-roundtrip-{}-{}",
        std::process::id(),
        now_millis()
    ));
    write_downloads_json(&dir, &[sample_entry()]).unwrap();
    let entries = read_downloads_json(&dir).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].filename, "Artist - Song.mp3");
    assert_eq!(entries[0].create_time, 1_700_000_000_000.0);

    // Legacy sidecar written by an old version must still load.
    let legacy = r#"[{
        "filename": "Old.mp3",
        "song": {},
        "quality": "128k",
        "create_time": 1.0
    }]"#;
    std::fs::write(dir.join("downloads.json"), legacy).unwrap();
    let entries = read_downloads_json(&dir).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].create_time, 1.0);
    let _ = std::fs::remove_dir_all(dir);
}

fn temp_meta_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "tunefree-meta-{}-{}-{}",
        label,
        std::process::id(),
        now_millis()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn entry_named(filename: &str) -> DownloadMetaEntry {
    DownloadMetaEntry {
        filename: filename.to_string(),
        ..sample_entry()
    }
}

#[test]
fn read_downloads_json_reports_corrupt_sidecars() {
    let dir = temp_meta_dir("corrupt");
    for corrupt in [
        "not json at all",
        "{\"filename\":\"a.mp3\"}",
        "[{\"filename\":\"a.mp3\"}]",
        "",
    ] {
        std::fs::write(dir.join("downloads.json"), corrupt).unwrap();
        assert!(
            read_downloads_json(&dir).is_err(),
            "损坏的 downloads.json 必须报告失败: {corrupt}"
        );
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn write_downloads_json_leaves_no_temp_file_behind() {
    let dir = temp_meta_dir("temp-file");
    write_downloads_json(&dir, &[sample_entry()]).unwrap();

    let leftovers = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .contains("downloads.json.partial-")
        })
        .count();
    assert_eq!(leftovers, 0);
    assert!(dir.join("downloads.json").exists());
    let _ = std::fs::remove_dir_all(dir);
}

/// downloads.json 是读-改-写，没有锁时并发命令会互相覆盖。这里让 8 个线程
/// 同时各写入一条记录，全部保留才说明锁真的串行化了整个读改写周期。
#[test]
fn concurrent_saves_under_the_store_lock_keep_every_entry() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let dir = temp_meta_dir("concurrent-save");
    write_downloads_json(&dir, &[]).unwrap();
    let store = DownloadMetaStore::default();
    // 临界区内的并发线程数，锁生效时恒为 1。
    let inside = AtomicUsize::new(0);
    let max_inside = AtomicUsize::new(0);

    std::thread::scope(|scope| {
        for index in 0..8 {
            let store = store.clone();
            let dir = dir.clone();
            let inside = &inside;
            let max_inside = &max_inside;
            scope.spawn(move || {
                store.with_lock(|| {
                    let concurrent = inside.fetch_add(1, Ordering::SeqCst) + 1;
                    max_inside.fetch_max(concurrent, Ordering::SeqCst);
                    let mut entries = read_downloads_json(&dir).unwrap();
                    entries.push(entry_named(&format!("song-{index}.mp3")));
                    write_downloads_json(&dir, &entries).unwrap();
                    inside.fetch_sub(1, Ordering::SeqCst);
                });
            });
        }
    });

    assert_eq!(max_inside.load(Ordering::SeqCst), 1, "读改写必须互斥");

    let mut names: Vec<String> = read_downloads_json(&dir)
        .unwrap()
        .into_iter()
        .map(|entry| entry.filename)
        .collect();
    names.sort();
    let expected: Vec<String> = (0..8).map(|index| format!("song-{index}.mp3")).collect();
    assert_eq!(names, expected);
    let _ = std::fs::remove_dir_all(dir);
}

/// 交错的保存与删除同样必须互不丢失：删除 4 条、同时新增 4 条，
/// 结果应恰好是"剩下的 4 条 + 新增的 4 条"。
#[test]
fn concurrent_saves_and_deletes_do_not_lose_writes() {
    let dir = temp_meta_dir("concurrent-mixed");
    let initial: Vec<DownloadMetaEntry> = (0..8)
        .map(|index| entry_named(&format!("old-{index}.mp3")))
        .collect();
    write_downloads_json(&dir, &initial).unwrap();
    let store = DownloadMetaStore::default();

    std::thread::scope(|scope| {
        for index in 0..4 {
            let deleter_store = store.clone();
            let deleter_dir = dir.clone();
            scope.spawn(move || {
                deleter_store.with_lock(|| {
                    let target = format!("old-{index}.mp3");
                    let mut entries = read_downloads_json(&deleter_dir).unwrap();
                    entries.retain(|entry| entry.filename != target);
                    write_downloads_json(&deleter_dir, &entries).unwrap();
                });
            });
            let writer_store = store.clone();
            let writer_dir = dir.clone();
            scope.spawn(move || {
                writer_store.with_lock(|| {
                    let mut entries = read_downloads_json(&writer_dir).unwrap();
                    entries.push(entry_named(&format!("new-{index}.mp3")));
                    write_downloads_json(&writer_dir, &entries).unwrap();
                });
            });
        }
    });

    let mut names: Vec<String> = read_downloads_json(&dir)
        .unwrap()
        .into_iter()
        .map(|entry| entry.filename)
        .collect();
    names.sort();
    let mut expected: Vec<String> = (4..8).map(|index| format!("old-{index}.mp3")).collect();
    expected.extend((0..4).map(|index| format!("new-{index}.mp3")));
    expected.sort();
    assert_eq!(names, expected);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn meta_store_lock_serializes_operations() {
    let store = DownloadMetaStore::default();
    let doubled = store.with_lock(|| 21 * 2);
    assert_eq!(doubled, 42);
    // A clone must share the same lock instance.
    let clone = store.clone();
    let _guard = store.lock.lock();
    assert!(clone.lock.try_lock().is_none());
}

fn metadata() -> DownloadMetadataInput {
    DownloadMetadataInput {
        song: sample_entry().song,
        quality: "320k".to_string(),
    }
}

#[test]
fn saves_metadata_in_the_downloads_original_directory_and_invalidates_index() {
    let original = temp_meta_dir("original-directory");
    let changed = temp_meta_dir("changed-directory");
    let store = DownloadMetaStore::default();
    assert!(store
        .matching_entries(&original, "1", "netease")
        .unwrap()
        .is_empty());
    std::fs::write(original.join("song.mp3"), b"audio").unwrap();
    save_download_metadata(&original, &store, "song.mp3".to_string(), metadata()).unwrap();
    let entries = store.matching_entries(&original, "1", "netease").unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].size, 5);
    assert!(!changed.join("downloads.json").exists());
    assert!(store
        .matching_entries(&changed, "1", "netease")
        .unwrap()
        .is_empty());
    assert_eq!(
        store
            .matching_entries(&original, "1", "netease")
            .unwrap()
            .len(),
        1
    );
    let _ = std::fs::remove_dir_all(original);
    let _ = std::fs::remove_dir_all(changed);
}

#[test]
fn damaged_metadata_is_preserved_and_audio_is_not_deleted() {
    let dir = temp_meta_dir("preserve-corrupt");
    std::fs::write(dir.join("song.mp3"), b"audio").unwrap();
    std::fs::write(dir.join("downloads.json"), b"{broken").unwrap();
    let result = save_download_metadata(
        &dir,
        &DownloadMetaStore::default(),
        "song.mp3".to_string(),
        metadata(),
    );
    assert!(result.is_err());
    assert_eq!(
        std::fs::read(dir.join("downloads.json")).unwrap(),
        b"{broken"
    );
    assert_eq!(std::fs::read(dir.join("song.mp3")).unwrap(), b"audio");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn index_observes_external_changes_deletion_and_numeric_song_ids() {
    let dir = temp_meta_dir("index-external");
    let store = DownloadMetaStore::default();
    write_downloads_json(&dir, &[sample_entry()]).unwrap();
    assert_eq!(
        store.matching_entries(&dir, "1", "netease").unwrap().len(),
        1
    );
    let mut replacement = entry_named("changed-long-filename.mp3");
    replacement.song = serde_json::json!({"id": 2, "source": "qq"});
    write_downloads_json(&dir, &[replacement]).unwrap();
    assert!(store
        .matching_entries(&dir, "1", "netease")
        .unwrap()
        .is_empty());
    assert_eq!(store.matching_entries(&dir, "2", "qq").unwrap().len(), 1);
    std::fs::remove_file(dir.join("downloads.json")).unwrap();
    assert!(store.matching_entries(&dir, "2", "qq").unwrap().is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn download_metadata_rejects_invalid_ipc_inputs() {
    for value in [
        serde_json::json!({"song": {}, "quality": "320k"}),
        serde_json::json!({"song": {"id": true, "source": "qq"}, "quality": "320k"}),
        serde_json::json!({"song": {"id": "1", "source": ""}, "quality": "320k"}),
        serde_json::json!({"song": {"id": "1", "source": "qq"}, "quality": "unknown"}),
    ] {
        let input: DownloadMetadataInput = serde_json::from_value(value).unwrap();
        assert_eq!(
            input.validate().unwrap_err().code,
            crate::app::error::ErrorCode::InvalidArgument
        );
    }
    let input: DownloadMetadataInput = serde_json::from_value(serde_json::json!({
        "song": {"id": "1", "source": "qq", "lrc": "离线歌词"}, "quality": "flac"
    }))
    .unwrap();
    assert!(input.validate().is_ok());
    assert_eq!(input.song["lrc"], "离线歌词");
}
