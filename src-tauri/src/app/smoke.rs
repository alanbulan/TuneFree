//! Isolated startup smoke-test support. Inert during normal launches.
use super::error::{CommandError, CommandResult};
use std::{path::PathBuf, sync::OnceLock};

struct SmokeConfig {
    dir: PathBuf,
    marker: PathBuf,
    run_id: String,
}
static CONFIG: OnceLock<SmokeConfig> = OnceLock::new();

#[cfg(all(test, any(windows, target_os = "macos")))]
#[path = "__tests__/smoke_credentials.rs"]
mod credential_tests;

pub(crate) fn is_enabled() -> bool {
    CONFIG.get().is_some()
}
pub(crate) fn data_dir() -> Option<PathBuf> {
    CONFIG.get().map(|config| config.dir.clone())
}

/// Startup diagnostics contain only isolated renderer state, never user data.
pub(crate) fn observe(app: &tauri::App) {
    use tauri::Manager;
    if !is_enabled() {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        log::error!("冒烟启动：缺少主窗口");
        return;
    };
    tauri::async_runtime::spawn(async move {
        for _ in 0..3 {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            let result = window.eval_with_callback(
                "JSON.stringify({readyState:document.readyState,rootChildren:document.getElementById('root')?.childElementCount??-1,native:!!window.__TAURI_INTERNALS__,visible:document.visibilityState,scripts:document.scripts.length})",
                |state| log::info!("冒烟渲染状态：{state}"),
            );
            if let Err(error) = result {
                log::warn!("冒烟启动：读取渲染状态失败：{error}");
            }
        }
    });
}

pub(crate) fn configure<R: tauri::Runtime>(context: &mut tauri::Context<R>) -> CommandResult<()> {
    let Some(marker) = std::env::var_os("TUNEFREE_SMOKE_MARKER") else {
        return Ok(());
    };
    let dir = std::env::var_os("TUNEFREE_SMOKE_DIR")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute() && dir.is_dir())
        .ok_or_else(|| CommandError::invalid_argument("冒烟测试必须指定已存在的绝对隔离目录"))?;
    let marker = PathBuf::from(marker);
    if marker
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        != dir.canonicalize().ok()
    {
        return Err(CommandError::invalid_argument(
            "就绪标记必须位于冒烟隔离目录内",
        ));
    }
    let run_id = std::env::var("TUNEFREE_SMOKE_RUN_ID")
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CommandError::invalid_argument("缺少冒烟测试标识"))?;
    let webview_dir = dir.join("webview");
    // Windows 的配置路径解析可能回落到默认用户目录；必须同时使用 WebView2 的进程级覆盖。
    #[cfg(windows)]
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").as_deref() != Some(webview_dir.as_os_str()) {
        return Err(CommandError::invalid_argument(
            "冒烟测试必须将 WEBVIEW2_USER_DATA_FOLDER 指向隔离目录的 webview 子目录",
        ));
    }
    for window in &mut context.config_mut().app.windows {
        window.data_directory = Some(webview_dir.clone());
        // macOS 显示隔离窗口以便观察；前端对被遮挡的 WKWebView 仍确认 DOM
        // 已挂载，不依赖可能暂停的首帧。非持久化 WebView 隔离用户数据。
        window.visible = cfg!(target_os = "macos") && window.label == "main";
        #[cfg(target_os = "macos")]
        {
            window.incognito = true;
        }
    }
    CONFIG
        .set(SmokeConfig {
            dir,
            marker,
            run_id,
        })
        .map_err(|_| CommandError::internal("冒烟环境已初始化"))
}

fn marker_payload(port: u16, run_id: &str) -> serde_json::Value {
    serde_json::json!({ "ready": true, "port": port, "pid": std::process::id(), "runId": run_id })
}

pub(crate) fn record_frontend_ready(port: u16) -> CommandResult<()> {
    let Some(config) = CONFIG.get() else {
        return Ok(());
    };
    let text = serde_json::to_vec(&marker_payload(port, &config.run_id))?;
    let pending = config.marker.with_extension("partial");
    std::fs::write(&pending, text)?;
    std::fs::rename(&pending, &config.marker)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn readiness_marker_identifies_this_process_and_run() {
        let payload = marker_payload(51234, "isolated-run");
        assert_eq!(payload["ready"], true);
        assert_eq!(payload["port"], 51234);
        assert_eq!(payload["pid"], std::process::id());
        assert_eq!(payload["runId"], "isolated-run");
        assert!(payload.get("token").is_none());
    }
}
