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
    let entries = read_downloads_json(&dir);
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
    let entries = read_downloads_json(&dir);
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
fn read_downloads_json_tolerates_corrupt_sidecars() {
    let dir = temp_meta_dir("corrupt");
    for corrupt in [
        "not json at all",
        "{\"filename\":\"a.mp3\"}",
        "[{\"filename\":\"a.mp3\"}]",
        "",
    ] {
        std::fs::write(dir.join("downloads.json"), corrupt).unwrap();
        assert!(
            read_downloads_json(&dir).is_empty(),
            "损坏的 downloads.json 应降级为空列表: {corrupt}"
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
                    let mut entries = read_downloads_json(&dir);
                    entries.push(entry_named(&format!("song-{index}.mp3")));
                    write_downloads_json(&dir, &entries).unwrap();
                    inside.fetch_sub(1, Ordering::SeqCst);
                });
            });
        }
    });

    assert_eq!(max_inside.load(Ordering::SeqCst), 1, "读改写必须互斥");

    let mut names: Vec<String> = read_downloads_json(&dir)
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
                    let mut entries = read_downloads_json(&deleter_dir);
                    entries.retain(|entry| entry.filename != target);
                    write_downloads_json(&deleter_dir, &entries).unwrap();
                });
            });
            let writer_store = store.clone();
            let writer_dir = dir.clone();
            scope.spawn(move || {
                writer_store.with_lock(|| {
                    let mut entries = read_downloads_json(&writer_dir);
                    entries.push(entry_named(&format!("new-{index}.mp3")));
                    write_downloads_json(&writer_dir, &entries).unwrap();
                });
            });
        }
    });

    let mut names: Vec<String> = read_downloads_json(&dir)
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
