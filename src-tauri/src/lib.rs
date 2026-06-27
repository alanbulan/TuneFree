pub mod api;
pub mod server;

use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

/// Progress payload emitted during file downloads.
///
/// Contains the source URL and a 0–100 progress percentage.
/// Emitted via the `download-progress` event.
#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    url: String,
    progress: u8,
}

/// Progress payload emitted during update downloads.
///
/// Emitted via the `update-progress` event.
#[derive(Clone, serde::Serialize)]
struct UpdateProgress {
    progress: u8,
}

/// Application lifecycle state shared across the app.
///
/// Tracks whether the app is quitting (to prevent the desktop-lyric window
/// from closing prematurely) and holds a shutdown signal sender for
/// gracefully stopping the local HTTP server.
#[derive(Clone)]
struct AppLifecycleState {
    is_quitting: Arc<AtomicBool>,
    shutdown_tx: tokio::sync::watch::Sender<bool>,
}

/// Shows and focuses the main application window.
fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Initiates application shutdown.
///
/// Sets the quitting flag, sends the server shutdown signal, hides/closes
/// the desktop-lyric window, and exits the app.
fn quit_app_inner(app_handle: &tauri::AppHandle) {
    if let Some(state) = app_handle.try_state::<AppLifecycleState>() {
        state.is_quitting.store(true, Ordering::SeqCst);
        let _ = state.shutdown_tx.send(true);
    }

    if let Some(lyric_window) = app_handle.get_webview_window("desktop-lyric") {
        let _ = lyric_window.hide();
        let _ = lyric_window.close();
    }

    app_handle.exit(0);
}

/// Tauri command to quit the application.
#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle) {
    quit_app_inner(&app_handle);
}

/// Resolves the download directory for saving files.
///
/// If `use_default` is `true`, returns the executable's parent directory
/// (portable mode). Otherwise, returns the OS download directory.
///
/// Replaces the previous `unwrap()` calls with proper error handling.
fn resolve_download_dir(
    app_handle: &tauri::AppHandle,
    use_default: bool,
) -> Result<std::path::PathBuf, String> {
    if use_default {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                return Ok(parent.to_path_buf());
            }
        }
    }
    app_handle
        .path()
        .download_dir()
        .map_err(|e| format!("Cannot determine download dir: {}", e))
}

/// Downloads a file with streaming writes and progress reporting.
///
/// Streams response chunks directly to disk (avoiding loading the entire
/// file into memory) and emits progress events via `app_handle.emit()`.
///
/// # Arguments
/// * `client` - Shared HTTP client.
/// * `url` - Source URL to download from.
/// * `file_path` - Destination file path on disk.
/// * `event_name` - Tauri event name for progress updates (e.g. "download-progress").
/// * `app_handle` - Tauri app handle for emitting events.
///
/// # Returns
/// `Ok(())` on success, or an error string on failure.
async fn download_with_progress(
    client: &reqwest::Client,
    url: &str,
    file_path: &std::path::Path,
    event_name: &str,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("下载网络文件失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("网络请求失败，响应码: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    // Create file before streaming (avoids buffering entire file in memory)
    let mut file = std::fs::File::create(file_path)
        .map_err(|e| format!("创建本地文件失败: {}", e))?;

    // Send 0% initial progress
    let _ = app_handle.emit(
        event_name,
        DownloadProgress {
            url: url.to_string(),
            progress: 0,
        },
    );

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取文件块失败: {}", e))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("保存文件数据失败: {}", e))?;
        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let progress = ((downloaded as f64 / total_size as f64) * 100.0) as u8;
            let _ = app_handle.emit(
                event_name,
                DownloadProgress {
                    url: url.to_string(),
                    progress,
                },
            );
        }
    }

    // Send 100% completion progress
    let _ = app_handle.emit(
        event_name,
        DownloadProgress {
            url: url.to_string(),
            progress: 100,
        },
    );

    Ok(())
}

/// Tauri command to download a song to the local filesystem.
///
/// Streams the download to disk with progress events, avoiding loading
/// the entire file into memory. If `custom_dir` is provided and non-empty,
/// uses it; otherwise defaults to the executable's parent directory.
///
/// # Arguments
/// * `app_handle` - Tauri app handle.
/// * `client` - Shared HTTP client (injected via Tauri State).
/// * `url` - Source URL of the audio file.
/// * `filename` - Desired filename (with extension).
/// * `custom_dir` - Optional custom download directory.
///
/// # Returns
/// The full path to the saved file, or an error string.
#[tauri::command]
async fn download_song_to_local(
    app_handle: tauri::AppHandle,
    client: State<'_, reqwest::Client>,
    url: String,
    filename: String,
    custom_dir: Option<String>,
) -> Result<String, String> {
    let download_dir = match &custom_dir {
        Some(dir) if !dir.trim().is_empty() => std::path::PathBuf::from(dir),
        _ => resolve_download_dir(&app_handle, true)?,
    };

    let file_stem = std::path::Path::new(&filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let file_ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3")
        .to_string();

    let mut file_path = download_dir.join(&filename);

    let mut counter = 1;
    while file_path.exists() {
        let new_filename = format!("{} ({}).{}", file_stem, counter, file_ext);
        file_path = download_dir.join(new_filename);
        counter += 1;
    }

    download_with_progress(&client, &url, &file_path, "download-progress", &app_handle).await?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Metadata entry stored in downloads.json for each downloaded song.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct DownloadMetaEntry {
    filename: String,
    song: serde_json::Value,
    quality: String,
    create_time: f64,
    #[serde(default)]
    size: u64,
}

/// Result returned by resolve_local_playback for offline playback.
#[derive(Clone, serde::Serialize)]
struct ResolvedPlayback {
    filepath: String,
    song: serde_json::Value,
    quality: String,
}

/// Reads the downloads.json sidecar file from the download directory.
fn read_downloads_json(dir: &std::path::Path) -> Vec<DownloadMetaEntry> {
    let path = dir.join("downloads.json");
    if !path.exists() {
        return Vec::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Writes the downloads.json sidecar file.
fn write_downloads_json(dir: &std::path::Path, entries: &[DownloadMetaEntry]) -> Result<(), String> {
    let path = dir.join("downloads.json");
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("序列化 downloads.json 失败: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("写入 downloads.json 失败: {}", e))
}

/// Scans the download directory and returns all downloads with metadata.
///
/// Reads downloads.json for song metadata, cross-references with actual files
/// on disk, and removes orphaned entries (files deleted externally).
#[tauri::command]
fn scan_download_dir(
    app_handle: tauri::AppHandle,
    custom_dir: Option<String>,
) -> Result<Vec<DownloadMetaEntry>, String> {
    let dir = match &custom_dir {
        Some(d) if !d.trim().is_empty() => std::path::PathBuf::from(d),
        _ => resolve_download_dir(&app_handle, true)?,
    };

    let mut entries = read_downloads_json(&dir);

    // Retain only entries where the file still exists on disk
    let before = entries.len();
    entries.retain(|e| dir.join(&e.filename).exists());

    // If entries were removed (files deleted externally), update the JSON
    if entries.len() != before {
        write_downloads_json(&dir, &entries)?;
    }

    // Populate file size from disk metadata
    for entry in &mut entries {
        if let Ok(meta) = std::fs::metadata(dir.join(&entry.filename)) {
            entry.size = meta.len();
        }
    }

    // Sort by create_time descending (newest first)
    entries.sort_by(|a, b| b.create_time.partial_cmp(&a.create_time).unwrap_or(std::cmp::Ordering::Equal));

    Ok(entries)
}

/// Saves download metadata to downloads.json after a successful download.
#[tauri::command]
fn save_download_meta(
    app_handle: tauri::AppHandle,
    filename: String,
    song: serde_json::Value,
    quality: String,
    create_time: f64,
    custom_dir: Option<String>,
) -> Result<(), String> {
    let dir = match &custom_dir {
        Some(d) if !d.trim().is_empty() => std::path::PathBuf::from(d),
        _ => resolve_download_dir(&app_handle, true)?,
    };

    let mut entries = read_downloads_json(&dir);

    // Remove any existing entry with the same filename
    entries.retain(|e| e.filename != filename);

    entries.push(DownloadMetaEntry {
        filename,
        song,
        quality,
        create_time,
        size: 0,
    });

    write_downloads_json(&dir, &entries)
}

/// Deletes a downloaded file and removes its metadata entry.
#[tauri::command]
fn delete_download_file(
    app_handle: tauri::AppHandle,
    filename: String,
    custom_dir: Option<String>,
) -> Result<(), String> {
    let dir = match &custom_dir {
        Some(d) if !d.trim().is_empty() => std::path::PathBuf::from(d),
        _ => resolve_download_dir(&app_handle, true)?,
    };

    // Delete the file from disk (use trash if possible, otherwise remove)
    let file_path = dir.join(&filename);
    if file_path.exists() {
        std::fs::remove_file(&file_path)
            .map_err(|e| format!("删除文件失败: {}", e))?;
    }

    // Remove from downloads.json
    let mut entries = read_downloads_json(&dir);
    let before = entries.len();
    entries.retain(|e| e.filename != filename);

    if entries.len() != before {
        write_downloads_json(&dir, &entries)?;
    }

    Ok(())
}

/// Resolves a local file path for offline playback.
///
/// Searches downloads.json for a matching song (by ID and source), preferring
/// the requested quality but falling back to any available quality.
/// Returns the filepath, song metadata, and quality if found.
#[tauri::command]
fn resolve_local_playback(
    app_handle: tauri::AppHandle,
    song_id: String,
    source: String,
    quality: Option<String>,
    custom_dir: Option<String>,
) -> Result<Option<ResolvedPlayback>, String> {
    let dir = match &custom_dir {
        Some(d) if !d.trim().is_empty() => std::path::PathBuf::from(d),
        _ => resolve_download_dir(&app_handle, true)?,
    };

    let entries = read_downloads_json(&dir);

    // Find entries matching song ID and source
    let matches: Vec<&DownloadMetaEntry> = entries
        .iter()
        .filter(|e| {
            if let Some(id) = e.song.get("id").and_then(|v| v.as_str()) {
                id == song_id
            } else if let Some(id) = e.song.get("id").and_then(|v| v.as_i64()) {
                id.to_string() == song_id
            } else {
                false
            }
        })
        .filter(|e| {
            e.song
                .get("source")
                .and_then(|v| v.as_str())
                .map_or(false, |s| s == source)
        })
        .collect();

    if matches.is_empty() {
        return Ok(None);
    }

    // Prefer exact quality match, otherwise use first available
    let chosen = if let Some(ref q) = quality {
        matches.iter().find(|e| e.quality == *q)
    } else {
        None
    }.or_else(|| matches.first());

    if let Some(entry) = chosen {
        let file_path = dir.join(&entry.filename);
        if file_path.exists() {
            return Ok(Some(ResolvedPlayback {
                filepath: file_path.to_string_lossy().to_string(),
                song: entry.song.clone(),
                quality: entry.quality.clone(),
            }));
        }
    }

    Ok(None)
}

/// Payload for player control events relayed from the desktop-lyric window.
#[derive(Clone, serde::Serialize)]
struct PlayerControlPayload {
    action: String,
    value: Option<serde_json::Value>,
}

/// Relays player control commands from the desktop-lyric window to the main window.
///
/// The desktop-lyric window calls this via `invoke` (which doesn't require
/// event emission permissions), and the Rust side emits the event to the
/// main window using `emit_to` (which bypasses capability restrictions).
#[tauri::command]
async fn relay_player_control(
    app_handle: tauri::AppHandle,
    action: String,
    value: Option<serde_json::Value>,
) -> Result<(), String> {
    app_handle
        .emit_to(
            "main",
            "player-control",
            PlayerControlPayload { action, value },
        )
        .map_err(|e| format!("Failed to relay player control: {}", e))?;
    Ok(())
}

/// Tauri command to open an external URL in the system's default browser.
///
/// On Windows, uses `cmd /C start "" <url>` where the empty string
/// serves as the window title, preventing command injection when the URL
/// contains special characters (e.g. `&`).
///
/// # Arguments
/// * `url` - The URL to open.
#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tauri command to get the download directory path.
///
/// If `use_default` is `Some(true)`, returns the executable's parent
/// directory (portable mode). Otherwise, returns the OS download directory.
///
/// # Arguments
/// * `app_handle` - Tauri app handle.
/// * `use_default` - If `true`, use the executable's parent directory.
#[tauri::command]
fn get_download_dir(
    app_handle: tauri::AppHandle,
    use_default: Option<bool>,
) -> Result<String, String> {
    resolve_download_dir(&app_handle, use_default.unwrap_or(false))
        .map(|p| p.to_string_lossy().to_string())
}

/// Tauri command to get the default (portable) download directory.
///
/// Returns the executable's parent directory, falling back to the OS
/// download directory if the executable path cannot be determined.
///
/// # Arguments
/// * `app_handle` - Tauri app handle.
#[tauri::command]
fn get_default_download_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    resolve_download_dir(&app_handle, true).map(|p| p.to_string_lossy().to_string())
}

/// Tauri command to open a folder picker dialog for selecting a download directory.
///
/// Wraps the dialog callback in a 5-minute timeout to prevent indefinite
/// blocking if the user never responds.
///
/// # Arguments
/// * `app_handle` - Tauri app handle.
///
/// # Returns
/// `Some(path)` if a folder was selected, `None` if the dialog was cancelled.
#[tauri::command]
async fn select_download_dir(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    app_handle.dialog().file().pick_folder(move |folder_path| {
        let path = folder_path.and_then(|p| match p {
            tauri_plugin_dialog::FilePath::Path(path_buf) => {
                Some(path_buf.to_string_lossy().into_owned())
            }
            tauri_plugin_dialog::FilePath::Url(url) => url
                .to_file_path()
                .ok()
                .map(|pb| pb.to_string_lossy().into_owned()),
        });
        let _ = tx.send(path);
    });

    // 5-minute timeout to prevent indefinite blocking
    match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(e)) => Err(format!("对话框通道错误: {}", e)),
        Err(_) => Err("选择下载目录超时（5分钟）".to_string()),
    }
}

/// Tauri command to download and install an application update.
///
/// Validates that the update URL is from `github.com` or `githubusercontent.com`,
/// streams the download to disk with progress events, then launches the
/// installer using the platform-appropriate command.
///
/// # Arguments
/// * `app_handle` - Tauri app handle.
/// * `client` - Shared HTTP client (injected via Tauri State).
/// * `url` - Update package URL (must be from GitHub domains).
///
/// # Returns
/// `Ok(())` on success (the app exits after launching the installer).
#[tauri::command]
async fn download_and_install_update(
    app_handle: tauri::AppHandle,
    client: State<'_, reqwest::Client>,
    url: String,
) -> Result<(), String> {
    // URL whitelist: only allow GitHub domains
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    let host = parsed.host_str().unwrap_or("");
    if !host.ends_with("github.com") && !host.ends_with("githubusercontent.com") {
        return Err("Update URL must be from github.com or githubusercontent.com".into());
    }

    // Extract filename from URL path, fall back to platform default
    let update_filename = parsed
        .path_segments()
        .and_then(|mut s| s.next_back())
        .unwrap_or("TuneFree_update.exe");
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(update_filename);

    download_with_progress(&client, &url, &file_path, "update-progress", &app_handle).await?;

    let _ = app_handle.emit("update-progress", UpdateProgress { progress: 100 });

    // Launch installer using platform-appropriate command
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &file_path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("拉起安装程序失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("拉起安装程序失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("拉起安装程序失败: {}", e))?;
    }

    quit_app_inner(&app_handle);
    Ok(())
}

/// Entry point for the Tauri application.
///
/// Sets up the shared HTTP client, shutdown signal channel, tray icon,
/// window event handlers, and starts the local HTTP server.
/// Uses `.build()?.run()` to handle `RunEvent` callbacks for graceful shutdown.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create shutdown signal channel for graceful server shutdown
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    // Create shared HTTP client with sensible defaults
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_max_idle_per_host(20)
        .build()
        .expect("Failed to build HTTP client");

    let lifecycle = AppLifecycleState {
        is_quitting: Arc::new(AtomicBool::new(false)),
        shutdown_tx,
    };
    let window_lifecycle = lifecycle.clone();

    let app = tauri::Builder::default()
        .manage(lifecycle)
        .manage(client.clone())
        .invoke_handler(tauri::generate_handler![
            download_song_to_local,
            scan_download_dir,
            save_download_meta,
            delete_download_file,
            resolve_local_playback,
            relay_player_control,
            open_external_url,
            get_download_dir,
            get_default_download_dir,
            select_download_dir,
            download_and_install_update,
            quit_app
        ])
        .on_window_event(move |window, event| {
            if window.label() == "desktop-lyric" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if !window_lifecycle.is_quitting.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = window.hide();
                        let _ = window.emit_to("main", "desktop-lyric-closed", ());
                    }
                }
            }
        })
        .setup(move |app| {
            app.handle().plugin(tauri_plugin_dialog::init())?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let menu = MenuBuilder::new(app)
                .text("show", "显示 TuneFree")
                .separator()
                .text("quit", "退出 TuneFree")
                .build()?;

            let tray_icon = app.default_window_icon().cloned();
            let mut tray_builder = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("TuneFree")
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "show" => show_main_window(app_handle),
                    "quit" => quit_app_inner(app_handle),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => show_main_window(tray.app_handle()),
                    _ => {}
                });

            if let Some(icon) = tray_icon {
                tray_builder = tray_builder.icon(icon);
            }
            let _ = tray_builder.build(app)?;

            // Start the local Axum web server for resolving APIs
            tauri::async_runtime::spawn(server::start_server(
                app.handle().clone(),
                client.clone(),
                shutdown_rx,
            ));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<AppLifecycleState>() {
                let _ = state.shutdown_tx.send(true);
            }
        }
        _ => {}
    });
}
