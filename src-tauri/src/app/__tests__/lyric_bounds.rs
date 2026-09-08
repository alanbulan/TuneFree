use super::*;

struct Fixture {
    app: tauri::App,
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let app = crate::test_support::app();
        app.manage(DesktopLyricBoundsSaveState::default());
        let path = desktop_lyric_bounds_path(app.handle()).unwrap();
        Self { app, path }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let directory = self.path.parent().unwrap();
        assert_eq!(
            directory.file_name().unwrap().to_string_lossy(),
            self.app.config().identifier
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
fn bounds() -> DesktopLyricWindowBounds {
    build_desktop_lyric_bounds(
        PhysicalPosition::new(30, 40),
        PhysicalSize::new(900, 300),
        1.25,
    )
    .unwrap()
}

#[tokio::test]
async fn persisted_bounds_reject_corruption_and_keep_only_the_latest_generation() {
    let fixture = Fixture::new();
    let app = fixture.app.handle();
    assert!(read_desktop_lyric_bounds(app).is_none());
    for raw in ["broken", r#"{"x":0,"y":0,"width":1,"height":1}"#] {
        std::fs::write(&fixture.path, raw).unwrap();
        assert!(read_desktop_lyric_bounds(app).is_none());
    }
    let old = next_desktop_lyric_bounds_generation(app);
    let current = next_desktop_lyric_bounds_generation(app);
    persist_desktop_lyric_bounds_generation(app, &bounds(), old).unwrap();
    assert!(read_desktop_lyric_bounds(app).is_none());
    persist_desktop_lyric_bounds_generation(app, &bounds(), current).unwrap();
    assert_eq!(read_desktop_lyric_bounds(app), Some(bounds()));
    assert!(build_desktop_lyric_bounds(
        PhysicalPosition::new(0, 0),
        PhysicalSize::new(10, 10),
        1.0
    )
    .is_none());
    assert!(normalize_desktop_lyric_bounds(bounds(), &[], None).is_none());
    persist_visible_desktop_lyric_bounds(app);
}

#[tokio::test]
async fn bounds_worker_debounces_writes_releases_its_queue_and_reports_disk_failures() {
    let fixture = Fixture::new();
    let app = fixture.app.handle();
    let state = app.state::<DesktopLyricBoundsSaveState>();
    let generation = next_desktop_lyric_bounds_generation(app);
    let deadline = tokio::time::Instant::now() + Duration::from_millis(10);
    {
        let mut queue = state.queue.lock();
        queue.worker_active = true;
        queue.pending = Some(PendingBoundsSave {
            deadline,
            bounds: bounds(),
            generation,
        });
    }
    assert!(matches!(
        next_bounds_save_step(app),
        BoundsSaveStep::Sleep(_)
    ));
    run_desktop_lyric_bounds_saver(app.clone()).await;
    assert_eq!(read_desktop_lyric_bounds(app), Some(bounds()));
    assert!(!state.queue.lock().worker_active);
    std::fs::remove_file(&fixture.path).unwrap();
    std::fs::create_dir(&fixture.path).unwrap();
    assert!(write_desktop_lyric_bounds(app, &bounds())
        .unwrap_err()
        .contains("保存桌面歌词窗口位置失败"));
    state.queue.lock().pending = Some(PendingBoundsSave {
        deadline: tokio::time::Instant::now(),
        bounds: bounds(),
        generation,
    });
    run_desktop_lyric_bounds_saver(app.clone()).await;
    assert!(!state.queue.lock().worker_active);
    assert!(fixture.path.is_dir());
}
