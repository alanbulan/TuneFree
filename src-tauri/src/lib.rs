pub mod api;
pub mod server;

use std::io::Write;
use tauri::{Emitter, Manager};

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    url: String,
    progress: u8,
}

#[derive(Clone, serde::Serialize)]
struct UpdateProgress {
    progress: u8,
}

#[tauri::command]
async fn download_song_to_local(
    app_handle: tauri::AppHandle,
    url: String,
    filename: String,
    custom_dir: Option<String>,
) -> Result<String, String> {
    let download_dir = if let Some(dir) = custom_dir {
        if dir.trim().is_empty() {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|parent| parent.to_path_buf()))
                .unwrap_or_else(|| app_handle.path().download_dir().unwrap())
        } else {
            std::path::PathBuf::from(dir)
        }
    } else {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|parent| parent.to_path_buf()))
            .unwrap_or_else(|| app_handle.path().download_dir().unwrap())
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

    let client = reqwest::Client::new();
    let mut response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
        .map_err(|e| format!("下载网络文件失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("网络请求失败，响应码: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut bytes = Vec::with_capacity(total_size as usize);

    // 发送 0% 初始进度
    let _ = app_handle.emit("download-progress", DownloadProgress {
        url: url.clone(),
        progress: 0,
    });

    while let Some(chunk) = response.chunk().await.map_err(|e| format!("读取文件块失败: {}", e))? {
        bytes.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let progress = ((downloaded as f64 / total_size as f64) * 100.0) as u8;
            let _ = app_handle.emit("download-progress", DownloadProgress {
                url: url.clone(),
                progress,
            });
        }
    }

    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| format!("创建本地文件失败: {}", e))?;

    file.write_all(&bytes)
        .map_err(|e| format!("保存文件数据失败: {}", e))?;

    // 发送 100% 结束进度
    let _ = app_handle.emit("download-progress", DownloadProgress {
        url: url.clone(),
        progress: 100,
    });

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", &url])
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

#[tauri::command]
fn get_download_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    app_handle
        .path()
        .download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_default_download_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            return Ok(parent.to_string_lossy().to_string());
        }
    }
    app_handle
        .path()
        .download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn select_download_dir() -> Result<Option<String>, String> {
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"
        ])
        .output()
        .map_err(|e| format!("执行 PowerShell 失败: {}", e))?;

    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path_str.is_empty() {
            Ok(None)
        } else {
            Ok(Some(path_str))
        }
    } else {
        Err("取消选择或执行失败".to_string())
    }
}

#[tauri::command]
async fn download_and_install_update(
    app_handle: tauri::AppHandle,
    url: String,
) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join("TuneFree_update.exe");

    let client = reqwest::Client::new();
    let mut response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
        .map_err(|e| format!("下载更新包失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("网络请求失败，响应码: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut bytes = Vec::with_capacity(total_size as usize);

    let _ = app_handle.emit("update-progress", UpdateProgress { progress: 0 });

    while let Some(chunk) = response.chunk().await.map_err(|e| format!("读取更新包数据失败: {}", e))? {
        bytes.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let progress = ((downloaded as f64 / total_size as f64) * 100.0) as u8;
            let _ = app_handle.emit("update-progress", UpdateProgress { progress });
        }
    }

    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| format!("创建更新包文件失败: {}", e))?;

    file.write_all(&bytes)
        .map_err(|e| format!("保存更新包数据失败: {}", e))?;

    let _ = app_handle.emit("update-progress", UpdateProgress { progress: 100 });

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", &file_path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("拉起安装程序失败: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("拉起安装程序失败: {}", e))?;
    }

    app_handle.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        download_song_to_local,
        open_external_url,
        get_download_dir,
        get_default_download_dir,
        select_download_dir,
        download_and_install_update
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Start the local Axum web server for resolving APIs
      tauri::async_runtime::spawn(server::start_server());

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

