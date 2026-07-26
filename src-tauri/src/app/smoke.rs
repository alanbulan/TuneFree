//! Startup smoke-test hook.
//!
//! v1.1.28 shipped a build that compiled, passed clippy and every unit test,
//! yet could not start: `LocalServerState` was registered from `setup`, which
//! runs after the windows begin loading, so the renderer's very first command
//! failed with "state not managed". Nothing in CI launched the app, so nothing
//! caught it.
//!
//! This module closes that gap. When `TUNEFREE_SMOKE_MARKER` names a path, the
//! app records a readiness marker there once the renderer has completed its
//! first IPC round-trip — proving the webview loaded, the frontend bundle ran,
//! and command dispatch works end to end. `scripts/smoke-test.mjs` polls for
//! that file. The hook is inert when the variable is unset, so release builds
//! for users are unaffected.

const SMOKE_MARKER_ENV: &str = "TUNEFREE_SMOKE_MARKER";

/// Records that the renderer successfully completed its first command call.
///
/// Failures are ignored: a smoke marker that cannot be written must never
/// affect a real launch.
pub(crate) fn record_frontend_ready(port: u16) {
    let Ok(path) = std::env::var(SMOKE_MARKER_ENV) else {
        return;
    };
    if path.is_empty() {
        return;
    }
    if let Err(error) = std::fs::write(&path, format!("ready port={}\n", port)) {
        log::warn!("写入冒烟测试标记失败 ({}): {}", path, error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Both cases share one test: the env var is process-global, so running
    /// them as separate `#[test]` functions would race under the default
    /// multi-threaded harness.
    #[test]
    fn marker_is_written_only_when_the_env_var_names_a_path() {
        let dir = std::env::temp_dir().join("tunefree-smoke-marker-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("ready.txt");

        std::env::remove_var(SMOKE_MARKER_ENV);
        record_frontend_ready(1234);
        assert!(!marker.exists(), "无标记路径时不应写入");

        std::env::set_var(SMOKE_MARKER_ENV, &marker);
        record_frontend_ready(51234);
        let recorded = std::fs::read_to_string(&marker).unwrap();
        assert!(recorded.contains("port=51234"), "unexpected: {}", recorded);

        std::env::remove_var(SMOKE_MARKER_ENV);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
