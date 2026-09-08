use super::*;
use crate::test_support::TempDir;

#[test]
fn long_song_names_keep_unique_numeric_suffixes_without_overwriting_downloads() {
    let directory = TempDir::new();
    let name = format!("{}.mp3", "音".repeat(160));
    std::fs::write(directory.0.join(&name), b"original").unwrap();
    for number in 1..=3 {
        let (path, filename) =
            unique_download_path(&directory.0, &name, None, AUDIO_FILE_EXTENSIONS).unwrap();
        assert!(filename.ends_with(&format!(" ({number}).mp3")));
        assert_eq!(filename.chars().count(), 164);
        assert!(!path.exists());
        std::fs::write(path, b"next").unwrap();
    }
    assert_eq!(std::fs::read(directory.0.join(name)).unwrap(), b"original");
}

#[test]
fn invalid_or_empty_windows_filenames_are_rejected_before_joining_a_directory() {
    for name in ["", " ", ".", "..", "...", "...mp3", "C:track.mp3"] {
        assert_eq!(
            sanitize_filename(name, None, AUDIO_FILE_EXTENSIONS)
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgument
        );
    }
}

#[test]
fn exhausted_numeric_suffixes_return_an_error_and_preserve_every_existing_file() {
    let directory = TempDir::new();
    std::fs::write(directory.0.join("song.mp3"), b"original").unwrap();
    for number in 1..10_000 {
        std::fs::File::create(directory.0.join(format!("song ({number}).mp3"))).unwrap();
    }
    let error =
        unique_download_path(&directory.0, "song.mp3", None, AUDIO_FILE_EXTENSIONS).unwrap_err();
    assert_eq!(error.code, ErrorCode::Io);
    assert!(error.message.contains("不重复的文件名"));
    assert_eq!(
        std::fs::read(directory.0.join("song.mp3")).unwrap(),
        b"original"
    );
    assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 10_000);
}

#[test]
fn a_directory_config_cannot_be_removed_while_another_process_holds_it_open() {
    use std::os::windows::fs::OpenOptionsExt;
    let directory = TempDir::new();
    let config = directory.0.join("download-dir.txt");
    std::fs::write(&config, directory.0.to_string_lossy().as_bytes()).unwrap();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&config)
        .unwrap();
    assert_eq!(
        remove_download_dir_config(&config).unwrap_err().code,
        ErrorCode::Io
    );
    assert!(config.exists());
    drop(lock);
    remove_download_dir_config(&config).unwrap();
    assert!(!config.exists());
}
