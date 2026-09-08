use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use super::desktop_lyric_bounds::{
    persist_desktop_lyric_bounds_now, persist_visible_desktop_lyric_bounds,
    schedule_desktop_lyric_bounds_save, DesktopLyricBoundsSaveState,
};
use super::desktop_lyric_render::DesktopLyricRenderState;
use super::downloads::{DownloadClient, DownloadTaskRegistry};
use super::system_commands::{
    generate_local_server_token, quit_app_inner, show_main_window, AppLifecycleState,
    LocalServerState,
};
use super::{
    desktop_lyric, desktop_lyric_bounds, desktop_lyric_render, downloads, recommendation_commands,
    system_commands, updater,
};
use crate::{recommendation::RecommendationService, server};

#[cfg(all(test, windows))]
#[path = "__tests__/proxy_redirects.rs"]
mod proxy_redirect_tests;

struct BootstrapContext {
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
    api_client: reqwest::Client,
    download_client: reqwest::Client,
    proxy_client: reqwest::Client,
    lifecycle: AppLifecycleState,
    /// The bound listener, or the bind failure to report from `setup`.
    server_listener: std::io::Result<std::net::TcpListener>,
    local_server_port: u16,
    local_server_token: String,
}

struct SetupContext {
    api_client: reqwest::Client,
    proxy_client: reqwest::Client,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
    server_listener: std::io::Result<std::net::TcpListener>,
    local_server_port: u16,
    local_server_token: String,
}

fn build_api_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(20)
        .build()
        .expect("Failed to build HTTP client")
}

fn build_download_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(8)
        .build()
        .expect("Failed to build download HTTP client")
}

fn build_proxy_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .redirect(proxy_redirect_policy())
        .pool_max_idle_per_host(20)
        .build()
        .expect("Failed to build streaming proxy HTTP client")
}

fn proxy_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let url = attempt.url();
        let allowed = matches!(url.scheme(), "http" | "https")
            && url
                .host_str()
                .is_some_and(crate::api::proxy::is_allowed_host);
        if !allowed {
            return attempt.error("proxy redirect target is not allowed");
        }
        if attempt.previous().len() >= 10 {
            return attempt.error("too many proxy redirects");
        }
        attempt.follow()
    })
}

/// Builds the bootstrap context, binding the loopback listener up front.
///
/// The bind happens before `tauri::Builder` so that `LocalServerState` can be
/// managed in the builder chain: windows start loading the frontend as soon as
/// they are created, and `get_local_server_info` is one of the first commands
/// the renderer issues. Registering that state from `setup` instead loses the
/// race and fails the command with "state not managed".
fn create_bootstrap_context() -> super::error::CommandResult<BootstrapContext> {
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let server_listener = server::bind_local_listener();
    let local_server_port = server_listener
        .as_ref()
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map_or(0, |address| address.port());
    Ok(BootstrapContext {
        shutdown_rx,
        api_client: build_api_client(),
        download_client: build_download_client(),
        proxy_client: build_proxy_client(),
        lifecycle: AppLifecycleState {
            is_quitting: Arc::new(AtomicBool::new(false)),
            shutdown_tx,
        },
        server_listener,
        local_server_port,
        local_server_token: generate_local_server_token()?,
    })
}

/// Builds the log plugin for both debug and release builds.
///
/// Release builds run with `windows_subsystem = "windows"`, so a rotating file
/// in the app log directory is the only way to diagnose startup failures in
/// the field; debug builds keep the default stdout + log-dir targets.
fn build_log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    const MAX_LOG_FILE_SIZE: u128 = 2 * 1024 * 1024;
    let builder = tauri_plugin_log::Builder::new()
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .max_file_size(MAX_LOG_FILE_SIZE);
    if let Some(dir) = super::smoke::data_dir() {
        return builder
            .level(log::LevelFilter::Info)
            .targets([tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Folder {
                    path: dir.join("logs"),
                    file_name: None,
                },
            )])
            .build();
    }
    if cfg!(debug_assertions) {
        builder.level(log::LevelFilter::Info).build()
    } else {
        builder
            .level(log::LevelFilter::Warn)
            .targets([tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::LogDir { file_name: None },
            )])
            .build()
    }
}

fn configure_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("show", "显示 TuneFree")
        .separator()
        .text("quit", "退出 TuneFree")
        .build()?;
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
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                show_main_window(tray.app_handle());
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }
    let _ = tray_builder.build(app)?;
    Ok(())
}

/// Reports a loopback bind failure to the user and exits.
///
/// A bind failure used to panic, which release builds swallowed silently
/// because of `windows_subsystem = "windows"`; a native dialog is the only
/// reliable channel to the user at this point.
fn report_bind_failure_and_exit(app: &tauri::App, error: &std::io::Error) -> ! {
    log::error!("绑定本地回环端口失败: {}", error);
    app.dialog()
        .message("无法启动本地服务（回环端口绑定失败）。\n请检查防火墙或安全软件设置后重新启动 TuneFree。")
        .title("TuneFree 启动失败")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    std::process::exit(1);
}

fn setup_application(
    app: &mut tauri::App,
    context: SetupContext,
) -> Result<(), Box<dyn std::error::Error>> {
    // Windows are created — and start loading the frontend — before `setup`
    // runs, so any state the renderer's first commands need must already be
    // registered. v1.1.28 shipped with `LocalServerState` managed here instead
    // and lost that race on slower machines, failing every launch with
    // "state not managed". Assert the invariant so a future move is caught.
    debug_assert!(
        app.try_state::<LocalServerState>().is_some(),
        "LocalServerState 必须在 Builder 链上注册，不能放在 setup 中"
    );
    if let Some(window) = app.get_webview_window("desktop-lyric") {
        desktop_lyric_bounds::apply_desktop_lyric_bounds(&window);
    }
    let recommendation_service = Arc::new(RecommendationService::new_deferred(
        app.handle().clone(),
        context.api_client.clone(),
    ));
    recommendation_service.initialize_in_background();
    app.manage(recommendation_service);
    configure_tray(app)?;

    // LocalServerState is already managed by the builder; only the listener
    // itself is handed over here.
    let server_listener = match context.server_listener {
        Ok(listener) => listener,
        Err(error) => report_bind_failure_and_exit(app, &error),
    };
    tauri::async_runtime::spawn(server::start_server(
        server::ServerState {
            api_client: context.api_client,
            proxy_client: context.proxy_client,
            token: context.local_server_token,
            port: context.local_server_port,
        },
        server_listener,
        context.shutdown_rx,
    ));
    Ok(())
}

fn handle_desktop_lyric_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != "desktop-lyric" {
        return;
    }
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            schedule_desktop_lyric_bounds_save(window);
        }
        WindowEvent::CloseRequested { api, .. } => {
            persist_desktop_lyric_bounds_now(window);
            let is_quitting = window
                .try_state::<AppLifecycleState>()
                .is_some_and(|state| state.is_quitting.load(Ordering::SeqCst));
            if !is_quitting {
                api.prevent_close();
                let _ = window.hide();
                let _ = window.emit_to("main", "desktop-lyric-closed", ());
            }
        }
        _ => {}
    }
}

fn build_application(context: BootstrapContext) -> tauri::App {
    let mut app_context = tauri::generate_context!();
    super::smoke::configure(&mut app_context).expect("冒烟测试隔离环境无效");
    let setup_context = SetupContext {
        api_client: context.api_client.clone(),
        proxy_client: context.proxy_client,
        shutdown_rx: context.shutdown_rx,
        server_listener: context.server_listener,
        local_server_port: context.local_server_port,
        local_server_token: context.local_server_token.clone(),
    };
    let builder = tauri::Builder::default();
    // The single-instance plugin must be registered first so a second launch
    // exits before touching any shared resources; its callback runs in the
    // first instance and raises the (possibly tray-hidden) main window.
    #[cfg(desktop)]
    let builder = if super::smoke::is_enabled() {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(
            |app_handle, _args, _cwd| {
                show_main_window(app_handle);
            },
        ))
    };
    builder
        .plugin(build_log_plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(context.lifecycle)
        // Must be registered here rather than in `setup`: windows begin loading
        // the frontend before `setup` runs, and `get_local_server_info` is among
        // the first commands the renderer issues.
        .manage(LocalServerState {
            port: context.local_server_port,
            token: context.local_server_token,
        })
        .manage(context.api_client)
        .manage(DownloadClient(context.download_client))
        .manage(DownloadTaskRegistry::default())
        .manage(downloads::DownloadMetaStore::default())
        .manage(DesktopLyricBoundsSaveState::default())
        .manage(DesktopLyricRenderState::default())
        .invoke_handler(tauri::generate_handler![
            downloads::transfer::download_song_to_local,
            downloads::transfer::cancel_download,
            downloads::commands::scan_download_dir,
            downloads::commands::delete_download_file,
            downloads::commands::resolve_local_playback,
            system_commands::relay_player_control,
            system_commands::open_external_url,
            downloads::commands::open_download_dir,
            downloads::commands::get_download_dir,
            downloads::commands::get_default_download_dir,
            downloads::commands::reset_download_dir,
            downloads::commands::select_download_dir,
            updater::check_for_update,
            updater::download_and_install_update,
            system_commands::get_local_server_info,
            system_commands::mark_frontend_ready,
            recommendation_commands::log_recommendation_event,
            recommendation_commands::sync_recommendation_library,
            recommendation_commands::get_similar_songs,
            recommendation_commands::get_recommendation_job,
            recommendation_commands::get_latest_recommendation_job,
            recommendation_commands::dismiss_recommendation,
            recommendation_commands::save_recommendation_feedback,
            recommendation_commands::rebuild_recommendation_index,
            recommendation_commands::get_llm_config,
            recommendation_commands::save_llm_config,
            recommendation_commands::test_llm_provider,
            recommendation_commands::clear_recommendation_data,
            system_commands::quit_app,
            desktop_lyric_render::mark_desktop_lyric_ready,
            desktop_lyric::show_desktop_lyric_window,
            desktop_lyric::set_desktop_lyric_lock,
            desktop_lyric::hide_desktop_lyric_window
        ])
        .on_window_event(handle_desktop_lyric_event)
        .setup(move |app| setup_application(app, setup_context))
        .build(app_context)
        .expect("error while building tauri application")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = create_bootstrap_context().unwrap_or_else(|error| {
        eprintln!("启动失败: {}", error);
        std::process::exit(1);
    });
    // 正常退出时回到 Rust 入口，完成运行时清理并落盘覆盖率数据。
    let exit_code = build_application(context).run_return(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            persist_visible_desktop_lyric_bounds(app_handle);
            if let Some(state) = app_handle.try_state::<AppLifecycleState>() {
                let _ = state.shutdown_tx.send(true);
            }
        }
        _ => {}
    });
    if exit_code != 0 {
        std::process::exit(exit_code);
    }
}
