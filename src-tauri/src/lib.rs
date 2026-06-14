pub mod api;
pub mod server;

use std::io::Write;
use tauri::{Emitter, Manager};

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    url: String,
    progress: u8,
}

#[tauri::command]
async fn download_song_to_local(
    app_handle: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    let download_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| format!("无法获取系统下载目录: {}", e))?;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        download_song_to_local,
        open_external_url,
        get_download_dir
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

