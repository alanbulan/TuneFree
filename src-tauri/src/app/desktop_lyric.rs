use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, Window};

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct DesktopLyricWindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scale_factor: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct DesktopLyricWorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[derive(Default)]
pub(crate) struct DesktopLyricBoundsSaveState {
    generation: AtomicU64,
    write_lock: parking_lot::Mutex<()>,
}

const DESKTOP_LYRIC_BOUNDS_FILE: &str = "desktop-lyric-window.json";
const DESKTOP_LYRIC_MIN_WIDTH: u32 = 400;
const DESKTOP_LYRIC_MIN_HEIGHT: u32 = 200;
const DESKTOP_LYRIC_SAVE_DEBOUNCE: Duration = Duration::from_millis(300);

fn is_valid_scale_factor(scale_factor: f64) -> bool {
    scale_factor.is_finite() && (0.5..=8.0).contains(&scale_factor)
}

fn desktop_lyric_bounds_path<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法解析应用配置目录: {}", e))?;
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("无法创建应用配置目录: {}", e))?;
    Ok(app_dir.join(DESKTOP_LYRIC_BOUNDS_FILE))
}

fn is_valid_desktop_lyric_bounds(bounds: &DesktopLyricWindowBounds) -> bool {
    bounds.width >= DESKTOP_LYRIC_MIN_WIDTH
        && bounds.height >= DESKTOP_LYRIC_MIN_HEIGHT
        && bounds.scale_factor.is_none_or(is_valid_scale_factor)
}

fn read_desktop_lyric_bounds<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Option<DesktopLyricWindowBounds> {
    let path = desktop_lyric_bounds_path(app_handle).ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let bounds = serde_json::from_str::<DesktopLyricWindowBounds>(&raw).ok()?;
    is_valid_desktop_lyric_bounds(&bounds).then_some(bounds)
}

fn desktop_lyric_work_area(monitor: &Monitor) -> DesktopLyricWorkArea {
    let work_area = monitor.work_area();
    DesktopLyricWorkArea {
        x: work_area.position.x,
        y: work_area.position.y,
        width: work_area.size.width,
        height: work_area.size.height,
        scale_factor: monitor.scale_factor(),
    }
}

fn desktop_lyric_intersection_area(
    bounds: &DesktopLyricWindowBounds,
    work_area: DesktopLyricWorkArea,
) -> u64 {
    let left = i64::from(bounds.x).max(i64::from(work_area.x));
    let top = i64::from(bounds.y).max(i64::from(work_area.y));
    let right = (i64::from(bounds.x) + i64::from(bounds.width))
        .min(i64::from(work_area.x) + i64::from(work_area.width));
    let bottom = (i64::from(bounds.y) + i64::from(bounds.height))
        .min(i64::from(work_area.y) + i64::from(work_area.height));

    if right <= left || bottom <= top {
        return 0;
    }

    ((right - left) as u64).saturating_mul((bottom - top) as u64)
}

fn normalize_desktop_lyric_bounds(
    bounds: DesktopLyricWindowBounds,
    work_areas: &[DesktopLyricWorkArea],
    fallback_work_area: Option<DesktopLyricWorkArea>,
) -> Option<DesktopLyricWindowBounds> {
    let fallback_work_area = fallback_work_area.filter(|area| {
        area.width > 0 && area.height > 0 && is_valid_scale_factor(area.scale_factor)
    });
    let mut valid_work_areas = work_areas
        .iter()
        .copied()
        .filter(|area| {
            area.width > 0 && area.height > 0 && is_valid_scale_factor(area.scale_factor)
        })
        .collect::<Vec<_>>();
    if valid_work_areas.is_empty() {
        valid_work_areas.extend(fallback_work_area);
    }
    if valid_work_areas.is_empty() {
        return None;
    }

    let overlapping_work_area = valid_work_areas
        .iter()
        .copied()
        .map(|area| (desktop_lyric_intersection_area(&bounds, area), area))
        .max_by_key(|(intersection, _)| *intersection)
        .filter(|(intersection, _)| *intersection > 0)
        .map(|(_, area)| area);
    let target = overlapping_work_area
        .or(fallback_work_area)
        .unwrap_or(valid_work_areas[0]);

    let scale_ratio = bounds
        .scale_factor
        .filter(|scale_factor| is_valid_scale_factor(*scale_factor))
        .map(|scale_factor| target.scale_factor / scale_factor)
        .filter(|ratio| ratio.is_finite() && *ratio > 0.0)
        .unwrap_or(1.0);
    let scaled_width = (f64::from(bounds.width) * scale_ratio)
        .round()
        .clamp(1.0, f64::from(u32::MAX)) as u32;
    let scaled_height = (f64::from(bounds.height) * scale_ratio)
        .round()
        .clamp(1.0, f64::from(u32::MAX)) as u32;
    let minimum_width = DESKTOP_LYRIC_MIN_WIDTH.min(target.width);
    let minimum_height = DESKTOP_LYRIC_MIN_HEIGHT.min(target.height);
    let width = scaled_width.clamp(minimum_width, target.width);
    let height = scaled_height.clamp(minimum_height, target.height);

    let minimum_x = i64::from(target.x);
    let minimum_y = i64::from(target.y);
    let maximum_x = minimum_x + i64::from(target.width) - i64::from(width);
    let maximum_y = minimum_y + i64::from(target.height) - i64::from(height);
    let x = i64::from(bounds.x).clamp(minimum_x, maximum_x) as i32;
    let y = i64::from(bounds.y).clamp(minimum_y, maximum_y) as i32;

    Some(DesktopLyricWindowBounds {
        x,
        y,
        width,
        height,
        scale_factor: Some(target.scale_factor),
    })
}

fn build_desktop_lyric_bounds(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale_factor: f64,
) -> Option<DesktopLyricWindowBounds> {
    let bounds = DesktopLyricWindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        scale_factor: Some(scale_factor),
    };
    is_valid_desktop_lyric_bounds(&bounds).then_some(bounds)
}

fn capture_desktop_lyric_bounds<R: Runtime>(
    window: &Window<R>,
) -> Option<DesktopLyricWindowBounds> {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return None;
    }

    build_desktop_lyric_bounds(
        window.outer_position().ok()?,
        window.outer_size().ok()?,
        window.scale_factor().ok()?,
    )
}

fn capture_desktop_lyric_webview_bounds<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Option<DesktopLyricWindowBounds> {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return None;
    }

    build_desktop_lyric_bounds(
        window.outer_position().ok()?,
        window.outer_size().ok()?,
        window.scale_factor().ok()?,
    )
}

fn write_desktop_lyric_bounds<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    bounds: &DesktopLyricWindowBounds,
) -> Result<(), String> {
    let path = desktop_lyric_bounds_path(app_handle)?;
    let json = serde_json::to_string_pretty(bounds)
        .map_err(|e| format!("序列化桌面歌词窗口位置失败: {}", e))?;
    std::fs::write(path, json).map_err(|e| format!("保存桌面歌词窗口位置失败: {}", e))
}

fn persist_desktop_lyric_bounds_generation<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    bounds: &DesktopLyricWindowBounds,
    generation: u64,
) -> Result<(), String> {
    let state = app_handle.state::<DesktopLyricBoundsSaveState>();
    let _write_guard = state.write_lock.lock();
    if state.generation.load(Ordering::Acquire) != generation {
        return Ok(());
    }
    write_desktop_lyric_bounds(app_handle, bounds)
}

fn next_desktop_lyric_bounds_generation<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> u64 {
    app_handle
        .state::<DesktopLyricBoundsSaveState>()
        .generation
        .fetch_add(1, Ordering::AcqRel)
        .wrapping_add(1)
}

pub(crate) fn schedule_desktop_lyric_bounds_save<R: Runtime>(window: &Window<R>) {
    let Some(bounds) = capture_desktop_lyric_bounds(window) else {
        return;
    };
    let app_handle = window.app_handle().clone();
    let generation = next_desktop_lyric_bounds_generation(&app_handle);

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(DESKTOP_LYRIC_SAVE_DEBOUNCE).await;
        let write_app_handle = app_handle.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            persist_desktop_lyric_bounds_generation(&write_app_handle, &bounds, generation)
        })
        .await;
        match result {
            Ok(Err(error)) => log::warn!("{}", error),
            Err(error) => log::warn!("桌面歌词窗口位置后台保存异常: {}", error),
            Ok(Ok(())) => {}
        }
    });
}

pub(crate) fn persist_desktop_lyric_bounds_now<R: Runtime>(window: &Window<R>) {
    let Some(bounds) = capture_desktop_lyric_bounds(window) else {
        return;
    };
    let app_handle = window.app_handle().clone();
    let generation = next_desktop_lyric_bounds_generation(&app_handle);
    if let Err(error) = persist_desktop_lyric_bounds_generation(&app_handle, &bounds, generation) {
        log::warn!("{}", error);
    }
}

pub(crate) fn persist_visible_desktop_lyric_bounds<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
    let Some(window) = app_handle.get_webview_window("desktop-lyric") else {
        return;
    };
    let Some(bounds) = capture_desktop_lyric_webview_bounds(&window) else {
        return;
    };
    let generation = next_desktop_lyric_bounds_generation(app_handle);
    if let Err(error) = persist_desktop_lyric_bounds_generation(app_handle, &bounds, generation) {
        log::warn!("{}", error);
    }
}

async fn persist_desktop_lyric_webview_bounds<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let Some(bounds) = capture_desktop_lyric_webview_bounds(window) else {
        return Ok(());
    };
    let app_handle = window.app_handle().clone();
    let generation = next_desktop_lyric_bounds_generation(&app_handle);
    let write_app_handle = app_handle.clone();

    tauri::async_runtime::spawn_blocking(move || {
        persist_desktop_lyric_bounds_generation(&write_app_handle, &bounds, generation)
    })
    .await
    .map_err(|error| format!("桌面歌词窗口位置后台保存异常: {}", error))?
}

fn apply_desktop_lyric_bounds<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    if let Some(bounds) = read_desktop_lyric_bounds(window.app_handle()) {
        let work_areas = window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(desktop_lyric_work_area)
            .collect::<Vec<_>>();
        let primary_work_area = window
            .primary_monitor()
            .ok()
            .flatten()
            .as_ref()
            .map(desktop_lyric_work_area);
        let Some(bounds) = normalize_desktop_lyric_bounds(bounds, &work_areas, primary_work_area)
        else {
            return;
        };
        let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
        let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
    }
}

fn apply_desktop_lyric_lock<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    lock: bool,
) -> Result<(), String> {
    window
        .set_focusable(!lock)
        .map_err(|e| format!("设置桌面歌词焦点状态失败: {}", e))?;
    window
        .set_ignore_cursor_events(lock)
        .map_err(|e| format!("设置桌面歌词锁定状态失败: {}", e))?;
    window
        .emit_to("desktop-lyric", "lock-change", lock)
        .map_err(|e| format!("同步桌面歌词锁定状态失败: {}", e))
}

#[tauri::command]
pub(crate) async fn show_desktop_lyric_window(
    app_handle: tauri::AppHandle,
    lock: bool,
) -> Result<(), String> {
    let lyric_window = app_handle
        .get_webview_window("desktop-lyric")
        .ok_or_else(|| "找不到桌面歌词窗口".to_string())?;

    let was_visible = lyric_window
        .is_visible()
        .map_err(|e| format!("读取桌面歌词显示状态失败: {}", e))?;
    if !was_visible {
        apply_desktop_lyric_bounds(&lyric_window);
    }
    apply_desktop_lyric_lock(&lyric_window, lock)?;
    lyric_window
        .show()
        .map_err(|e| format!("显示桌面歌词失败: {}", e))?;
    if !was_visible {
        apply_desktop_lyric_bounds(&lyric_window);
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn set_desktop_lyric_lock(
    app_handle: tauri::AppHandle,
    lock: bool,
) -> Result<(), String> {
    let lyric_window = app_handle
        .get_webview_window("desktop-lyric")
        .ok_or_else(|| "找不到桌面歌词窗口".to_string())?;
    apply_desktop_lyric_lock(&lyric_window, lock)
}

#[tauri::command]
pub(crate) async fn hide_desktop_lyric_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    let lyric_window = app_handle
        .get_webview_window("desktop-lyric")
        .ok_or_else(|| "找不到桌面歌词窗口".to_string())?;

    persist_desktop_lyric_webview_bounds(&lyric_window).await?;

    lyric_window
        .hide()
        .map_err(|e| format!("隐藏桌面歌词失败: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
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

    fn work_area(
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        scale_factor: f64,
    ) -> DesktopLyricWorkArea {
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
}
