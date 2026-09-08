use super::super::test_fixture::Downloads;
use super::*;

#[tokio::test]
async fn scanning_offline_resolution_and_deletion_share_the_authorized_directory() {
    let fixture = Downloads::new();
    let first = fixture.seed("older.mp3", "320k", 1.0, b"audio");
    let newer = fixture.seed("newer.flac", "flac", 2.0, b"lossless-audio");
    let missing = DownloadMetaEntry {
        filename: "missing.mp3".into(),
        ..first.clone()
    };
    write_downloads_json(&fixture.dir.0, &[first, missing, newer]).unwrap();
    let handle = fixture.app.handle().clone();
    let entries = scan_download_dir(handle.clone()).await.unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].filename, "newer.flac");
    assert_eq!(entries[0].size, 14);
    assert_eq!(read_downloads_json(&fixture.dir.0).unwrap().len(), 2);
    let selected =
        resolve_local_playback(handle.clone(), "1".into(), "qq".into(), Some("flac".into()))
            .await
            .unwrap()
            .unwrap();
    assert_eq!(selected.quality, "flac");
    assert!(selected.filepath.ends_with("newer.flac"));
    assert!(
        resolve_local_playback(handle.clone(), "missing".into(), "qq".into(), None)
            .await
            .unwrap()
            .is_none()
    );
    std::fs::remove_file(fixture.dir.0.join("newer.flac")).unwrap();
    let fallback =
        resolve_local_playback(handle.clone(), "1".into(), "qq".into(), Some("flac".into()))
            .await
            .unwrap()
            .unwrap();
    assert_eq!(fallback.quality, "320k");
    delete_download_file(handle.clone(), "older.mp3".into())
        .await
        .unwrap();
    assert!(!fixture.dir.0.join("older.mp3").exists());
    assert!(
        resolve_local_playback(handle.clone(), "1".into(), "qq".into(), None)
            .await
            .unwrap()
            .is_none()
    );
    delete_download_file(handle.clone(), "newer.flac".into())
        .await
        .unwrap();
    assert!(read_downloads_json(&fixture.dir.0).unwrap().is_empty());
    assert_eq!(
        get_download_dir(handle.clone()).await.unwrap(),
        display_path(&fixture.dir.0.canonicalize().unwrap())
    );
    let default = get_default_download_dir(handle.clone()).unwrap();
    assert_eq!(reset_download_dir(handle).await.unwrap(), default);
}

#[tokio::test]
async fn a_locked_file_is_not_misclassified_as_deleted_and_metadata_survives() {
    use std::os::windows::fs::OpenOptionsExt;
    let fixture = Downloads::new();
    let item = fixture.seed("locked.mp3", "320k", 1.0, b"audio");
    write_downloads_json(&fixture.dir.0, &[item]).unwrap();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(fixture.dir.0.join("locked.mp3"))
        .unwrap();
    let handle = fixture.app.handle().clone();
    assert_eq!(scan_download_dir(handle.clone()).await.unwrap().len(), 1);
    assert_eq!(
        delete_download_file(handle.clone(), "locked.mp3".into())
            .await
            .unwrap_err()
            .code,
        ErrorCode::Io
    );
    assert_eq!(read_downloads_json(&fixture.dir.0).unwrap().len(), 1);
    drop(lock);
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(fixture.dir.0.join("locked.mp3"))
        .unwrap();
    assert_eq!(
        delete_download_file(handle.clone(), "locked.mp3".into())
            .await
            .unwrap_err()
            .code,
        ErrorCode::Io
    );
    assert_eq!(read_downloads_json(&fixture.dir.0).unwrap().len(), 1);
    drop(lock);
    delete_download_file(handle, "locked.mp3".into())
        .await
        .unwrap();
    assert!(read_downloads_json(&fixture.dir.0).unwrap().is_empty());
}

#[tokio::test]
async fn blocking_task_panics_are_reported_as_command_errors() {
    let error = run_downloads_blocking::<(), _>(|| panic!("test worker panic"))
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Internal);
}
