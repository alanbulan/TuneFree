use super::*;

#[test]
fn sanitize_filename_rejects_path_traversal() {
    assert!(sanitize_filename("../evil.mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).is_err());
    assert!(sanitize_filename("..\\evil.mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).is_err());
    assert!(sanitize_filename("C:\\Windows\\win.ini", Some("mp3"), AUDIO_FILE_EXTENSIONS).is_err());
}

#[test]
fn sanitize_filename_keeps_apostrophes_and_handles_reserved_names() {
    assert_eq!(
        sanitize_filename("Rock 'n' Roll.mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap(),
        "Rock 'n' Roll.mp3"
    );
    assert_eq!(
        sanitize_filename("CON.mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap(),
        "_CON.mp3"
    );
}

#[test]
fn safe_join_keeps_files_inside_download_dir() {
    let dir = std::env::temp_dir().join(format!(
        "tunefree-safe-join-test-{}-{}",
        std::process::id(),
        now_millis()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let (path, filename) = safe_join_download_dir(
        &dir,
        "Artist - Song.mp3",
        Some("mp3"),
        AUDIO_FILE_EXTENSIONS,
    )
    .unwrap();
    assert_eq!(filename, "Artist - Song.mp3");
    assert_eq!(
        path.parent().unwrap(),
        canonicalize_dir(dir.clone()).unwrap().as_path()
    );
    let _ = std::fs::remove_dir_all(dir);
}
