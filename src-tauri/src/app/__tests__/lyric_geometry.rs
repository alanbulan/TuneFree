use super::*;

fn lyric_bounds(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: Option<f64>,
) -> DesktopLyricWindowBounds {
    DesktopLyricWindowBounds {
        x,
        y,
        width,
        height,
        scale_factor,
    }
}

fn work_area(x: i32, y: i32, width: u32, height: u32, scale_factor: f64) -> DesktopLyricWorkArea {
    DesktopLyricWorkArea {
        x,
        y,
        width,
        height,
        scale_factor,
    }
}

#[test]
fn desktop_lyric_bounds_accept_legacy_files_without_scale_factor() {
    let bounds: DesktopLyricWindowBounds =
        serde_json::from_str(r#"{"x":120,"y":80,"width":1150,"height":300}"#).unwrap();
    assert_eq!(bounds, lyric_bounds(120, 80, 1150, 300, None));
    assert!(is_valid_desktop_lyric_bounds(&bounds));
}

#[test]
fn desktop_lyric_bounds_reject_invalid_scale_factor() {
    assert!(!is_valid_desktop_lyric_bounds(&lyric_bounds(
        0,
        0,
        1150,
        300,
        Some(0.0)
    )));
    assert!(!is_valid_desktop_lyric_bounds(&lyric_bounds(
        0,
        0,
        1150,
        300,
        Some(f64::NAN)
    )));
}

#[test]
fn desktop_lyric_bounds_outside_all_monitors_are_clamped_to_fallback() {
    let primary = work_area(0, 0, 1920, 1040, 1.0);
    let normalized = normalize_desktop_lyric_bounds(
        lyric_bounds(5000, 4000, 1400, 500, Some(1.0)),
        &[primary],
        Some(primary),
    )
    .unwrap();
    assert_eq!(normalized, lyric_bounds(520, 540, 1400, 500, Some(1.0)));
}

#[test]
fn desktop_lyric_bounds_use_overlapping_monitor_and_preserve_logical_size() {
    let primary = work_area(0, 0, 1920, 1040, 1.0);
    let high_dpi = work_area(1920, 0, 2560, 1400, 2.0);
    let normalized = normalize_desktop_lyric_bounds(
        lyric_bounds(2000, 100, 600, 200, Some(1.0)),
        &[primary, high_dpi],
        Some(primary),
    )
    .unwrap();
    assert_eq!(normalized, lyric_bounds(2000, 100, 1200, 400, Some(2.0)));
}

#[test]
fn desktop_lyric_bounds_are_capped_to_the_visible_work_area() {
    let primary = work_area(-1280, 0, 1280, 720, 1.0);
    let normalized = normalize_desktop_lyric_bounds(
        lyric_bounds(-1600, -200, 4000, 2000, None),
        &[primary],
        Some(primary),
    )
    .unwrap();
    assert_eq!(normalized, lyric_bounds(-1280, 0, 1280, 720, Some(1.0)));
}

#[test]
fn desktop_lyric_bounds_can_use_primary_when_monitor_list_is_unavailable() {
    let primary = work_area(0, 0, 1600, 900, 1.25);
    let bounds = lyric_bounds(200, 100, 1000, 300, Some(1.25));
    assert_eq!(
        normalize_desktop_lyric_bounds(bounds.clone(), &[], Some(primary)).unwrap(),
        bounds
    );
}
