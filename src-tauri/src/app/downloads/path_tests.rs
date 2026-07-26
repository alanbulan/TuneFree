use super::*;

fn temp_test_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "tunefree-{}-{}-{}",
        label,
        std::process::id(),
        now_millis()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

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
    for reserved in ["nul.wav", "com1.flac", "LPT9.m4a", "_AUX.ogg"] {
        let sanitized = sanitize_filename(reserved, Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap();
        assert!(
            sanitized.starts_with('_'),
            "{reserved} 应被前缀下划线规避 Windows 保留名"
        );
    }
}

#[test]
fn sanitize_filename_enforces_the_extension_whitelist() {
    for rejected in ["payload.exe", "script.js", "page.html", "archive.zip"] {
        let error = sanitize_filename(rejected, Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap_err();
        assert_eq!(
            error.code,
            ErrorCode::InvalidArgument,
            "{rejected} 应被拒绝"
        );
    }
    // 大小写不敏感，且缺少扩展名时才使用回退扩展名。
    assert_eq!(
        sanitize_filename("Song.FLAC", None, AUDIO_FILE_EXTENSIONS).unwrap(),
        "Song.flac"
    );
    assert_eq!(
        sanitize_filename("Song", Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap(),
        "Song.mp3"
    );
    assert!(sanitize_filename("Song", None, AUDIO_FILE_EXTENSIONS).is_err());
}

#[test]
fn sanitize_filename_strips_dangerous_characters_and_caps_length() {
    assert_eq!(
        sanitize_filename("a<b>c:d\"e|f?g*h.mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap(),
        "a_b_c_d_e_f_g_h.mp3"
    );
    // Windows silently drops trailing dots/spaces, which would break the
    // later "does this file exist" check; they must be removed up front.
    assert_eq!(
        sanitize_filename("  track  . .mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap(),
        "track.mp3"
    );
    let long = format!("{}.mp3", "音".repeat(300));
    let sanitized = sanitize_filename(&long, Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap();
    assert_eq!(sanitized.chars().count(), 160 + ".mp3".len());
}

#[test]
fn unique_download_path_never_overwrites_an_existing_file() {
    let dir = temp_test_dir("unique-path");
    std::fs::write(dir.join("track.mp3"), b"first").unwrap();

    let (path, filename) =
        unique_download_path(&dir, "track.mp3", Some("mp3"), AUDIO_FILE_EXTENSIONS).unwrap();

    assert_eq!(filename, "track (1).mp3");
    assert!(!path.exists());
    assert_eq!(std::fs::read(dir.join("track.mp3")).unwrap(), b"first");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn verified_existing_download_path_rejects_traversal_and_missing_files() {
    let dir = temp_test_dir("verified-existing");
    std::fs::write(dir.join("track.mp3"), b"audio").unwrap();

    let resolved =
        verified_existing_download_path(&dir, "track.mp3", AUDIO_FILE_EXTENSIONS).unwrap();
    assert!(resolved.starts_with(canonicalize_dir(dir.clone()).unwrap()));

    let traversal =
        verified_existing_download_path(&dir, "../track.mp3", AUDIO_FILE_EXTENSIONS).unwrap_err();
    assert_eq!(traversal.code, ErrorCode::InvalidArgument);
    let missing =
        verified_existing_download_path(&dir, "absent.mp3", AUDIO_FILE_EXTENSIONS).unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn canonicalize_dir_creates_missing_dirs_and_rejects_files() {
    let root = temp_test_dir("canonicalize");
    let nested = root.join("a").join("b");
    let canonical = canonicalize_dir(nested.clone()).unwrap();
    assert!(canonical.is_dir());

    let file = root.join("not-a-dir.txt");
    std::fs::write(&file, b"x").unwrap();
    let error = canonicalize_dir(file).unwrap_err();
    assert_eq!(error.code, ErrorCode::DownloadDirInvalid);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn portable_marker_must_be_a_file_not_a_directory() {
    let exe_dir = temp_test_dir("portable-marker-dir");
    assert!(!is_portable_install(&exe_dir));
    std::fs::create_dir_all(exe_dir.join(PORTABLE_MARKER_FILE)).unwrap();
    assert!(!is_portable_install(&exe_dir));

    let os_dir = PathBuf::from("/os-downloads");
    let picked = choose_default_download_dir(Some(exe_dir.clone()), Some(os_dir.clone())).unwrap();
    assert_eq!(picked, os_dir.join(DOWNLOAD_SUBDIR_NAME));
    let _ = std::fs::remove_dir_all(exe_dir);
}

#[test]
fn choose_default_download_dir_without_exe_dir_uses_os_subdir() {
    let os_dir = PathBuf::from("/os-downloads");
    assert_eq!(
        choose_default_download_dir(None, Some(os_dir.clone())).unwrap(),
        os_dir.join(DOWNLOAD_SUBDIR_NAME)
    );
    assert_eq!(
        choose_default_download_dir(None, None).unwrap_err().code,
        ErrorCode::DownloadDirInvalid
    );
}

#[test]
fn download_dir_config_round_trips_and_reset_tolerates_a_missing_file() {
    let dir = temp_test_dir("dir-config");
    let config = dir.join(DOWNLOAD_DIR_CONFIG_FILE);
    assert_eq!(read_download_dir_config(&config), None);

    let approved = dir.join("音乐库");
    write_download_dir_config(&config, &approved).unwrap();
    assert_eq!(read_download_dir_config(&config), Some(approved));

    // reset_download_dir 的核心：清除后回落默认目录，且重复清除不报错。
    remove_download_dir_config(&config).unwrap();
    assert_eq!(read_download_dir_config(&config), None);
    remove_download_dir_config(&config).unwrap();
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn blank_download_dir_config_is_treated_as_no_approval() {
    let dir = temp_test_dir("dir-config-blank");
    let config = dir.join(DOWNLOAD_DIR_CONFIG_FILE);
    std::fs::write(&config, "   \r\n  ").unwrap();
    assert_eq!(read_download_dir_config(&config), None);

    std::fs::write(&config, "  C:/Music/TuneFree \n").unwrap();
    assert_eq!(
        read_download_dir_config(&config),
        Some(PathBuf::from("C:/Music/TuneFree"))
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// The renderer-supplied directory bypass (`customDir`) was the way an
/// unapproved path could be promoted to "approved". It must stay deleted, so
/// this guards the source itself rather than a runtime behaviour.
#[test]
fn download_commands_never_accept_a_caller_supplied_directory() {
    for source in [
        include_str!("commands.rs"),
        include_str!("transfer.rs"),
        include_str!("path.rs"),
    ] {
        assert!(!source.contains("custom_dir"), "下载目录旁路不得回归");
        assert!(!source.contains("customDir"), "下载目录旁路不得回归");
    }
}

/// `scan_download_dir` must stay a pure read: the only cleanup call site is
/// the download preparation path in `transfer.rs`.
#[test]
fn only_the_download_preparation_path_cleans_up_partials() {
    assert!(!include_str!("commands.rs").contains("cleanup_stale_partials"));
    assert_eq!(
        include_str!("transfer.rs")
            .matches("cleanup_stale_partials(")
            .count(),
        1
    );
}

#[test]
fn safe_join_keeps_files_inside_download_dir() {
    let dir = temp_test_dir("safe-join-test");
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

#[test]
fn choose_default_download_dir_prefers_portable_marker() {
    let exe_dir = temp_test_dir("portable-marker");
    std::fs::write(exe_dir.join(PORTABLE_MARKER_FILE), b"portable").unwrap();
    let picked =
        choose_default_download_dir(Some(exe_dir.clone()), Some(PathBuf::from("/os-downloads")))
            .unwrap();
    assert_eq!(picked, exe_dir);
    let _ = std::fs::remove_dir_all(exe_dir);
}

#[test]
fn choose_default_download_dir_uses_os_subdir_without_marker() {
    let exe_dir = temp_test_dir("no-portable-marker");
    let os_dir = PathBuf::from("/os-downloads");
    let picked = choose_default_download_dir(Some(exe_dir.clone()), Some(os_dir.clone())).unwrap();
    assert_eq!(picked, os_dir.join(DOWNLOAD_SUBDIR_NAME));

    let missing_os = choose_default_download_dir(Some(exe_dir.clone()), None);
    assert_eq!(missing_os.unwrap_err().code, ErrorCode::DownloadDirInvalid);
    let _ = std::fs::remove_dir_all(exe_dir);
}

#[test]
fn is_stale_partial_requires_a_provably_old_mtime() {
    let now = SystemTime::now();
    assert!(!is_stale_partial(None, now));
    assert!(!is_stale_partial(
        Some(now - Duration::from_secs(30 * 60)),
        now
    ));
    // A future mtime (clock skew) must keep the file.
    assert!(!is_stale_partial(Some(now + Duration::from_secs(60)), now));
    assert!(is_stale_partial(
        Some(now - STALE_PARTIAL_MAX_AGE - Duration::from_secs(1)),
        now
    ));
}

#[test]
fn cleanup_keeps_fresh_partials_and_regular_files() {
    let dir = temp_test_dir("cleanup-fresh");
    let fresh = dir.join("track.mp3.partial-1");
    let regular = dir.join("track.mp3");
    std::fs::write(&fresh, b"partial").unwrap();
    std::fs::write(&regular, b"audio").unwrap();

    cleanup_stale_partials(&dir, &HashSet::new());

    assert!(fresh.exists());
    assert!(regular.exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn cleanup_removes_stale_partials_but_skips_active_ones() {
    let dir = temp_test_dir("cleanup-stale");
    let stale = dir.join("stale.mp3.partial-1");
    let active = dir.join("active.mp3.partial-2");
    let regular = dir.join("track.mp3");
    std::fs::write(&stale, b"partial").unwrap();
    std::fs::write(&active, b"partial").unwrap();
    std::fs::write(&regular, b"audio").unwrap();

    let mut active_set = HashSet::new();
    active_set.insert(active.clone());
    // A far-future "now" makes every file look old, so only the active-set
    // guard can save the tracked partial.
    let future = SystemTime::now() + STALE_PARTIAL_MAX_AGE + Duration::from_secs(60);
    cleanup_stale_partials_at(&dir, &active_set, future);

    assert!(!stale.exists());
    assert!(active.exists());
    assert!(regular.exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn cleanup_is_a_no_op_on_a_missing_directory() {
    let missing = std::env::temp_dir().join(format!(
        "tunefree-cleanup-missing-{}-{}",
        std::process::id(),
        now_millis()
    ));
    assert!(!missing.exists());
    cleanup_stale_partials(&missing, &HashSet::new());
    cleanup_stale_partials_at(&missing, &HashSet::new(), SystemTime::now());
}

#[test]
fn cleanup_only_targets_partial_suffixed_files() {
    let dir = temp_test_dir("cleanup-scope");
    let keep = [
        dir.join("track.mp3"),
        dir.join("downloads.json"),
        dir.join("partial.mp3"),
        dir.join("track.mp3.partial"),
    ];
    for path in &keep {
        std::fs::write(path, b"data").unwrap();
    }
    let stale = dir.join("track.mp3.partial-1700000000000");
    std::fs::write(&stale, b"data").unwrap();

    let future = SystemTime::now() + STALE_PARTIAL_MAX_AGE + Duration::from_secs(60);
    cleanup_stale_partials_at(&dir, &HashSet::new(), future);

    for path in &keep {
        assert!(path.exists(), "{} 不应被清理", path.display());
    }
    assert!(!stale.exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn partial_path_stays_beside_its_target_file() {
    let target = PathBuf::from("/downloads").join("Artist - Song.mp3");
    let partial = partial_path_for(&target).unwrap();

    assert_eq!(partial.parent(), target.parent());
    let name = partial.file_name().unwrap().to_string_lossy().to_string();
    assert!(name.starts_with("Artist - Song.mp3.partial-"));
    assert!(partial_path_for(Path::new("/")).is_err());
}

#[test]
fn display_path_strips_extended_length_prefix() {
    assert_eq!(display_path(Path::new(r"\\?\C:\Music")), r"C:\Music");
    assert_eq!(display_path(Path::new("plain/dir")), "plain/dir");
}
