//! Isolated startup smoke-test support. Inert during normal launches.
use super::error::{CommandError, CommandResult};
use std::{path::PathBuf, sync::OnceLock};

struct SmokeConfig {
    dir: PathBuf,
    marker: PathBuf,
    run_id: String,
}
static CONFIG: OnceLock<SmokeConfig> = OnceLock::new();

#[cfg(all(test, windows))]
#[path = "__tests__/smoke_credentials.rs"]
mod credential_tests;

pub(crate) fn is_enabled() -> bool {
    CONFIG.get().is_some()
}
pub(crate) fn data_dir() -> Option<PathBuf> {
    CONFIG.get().map(|config| config.dir.clone())
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
        window.visible = false;
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
