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

use super::desktop_lyric::{
    persist_desktop_lyric_bounds_in_background, schedule_desktop_lyric_bounds_save,
    DesktopLyricBoundsSaveState,
};
use super::downloads::{DownloadClient, DownloadTaskRegistry};
use super::system_commands::{
    acquire_process_instance, quit_app_inner, show_main_window, AppLifecycleState, LocalServerState,
};
use super::{desktop_lyric, downloads, recommendation_commands, system_commands, updater};
use crate::{recommendation::RecommendationService, server};

struct BootstrapContext {
    process_instance: single_instance::SingleInstance,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
    server_listener: std::net::TcpListener,
    local_server_port: u16,
    api_client: reqwest::Client,
    download_client: reqwest::Client,
    proxy_client: reqwest::Client,
    lifecycle: AppLifecycleState,
}

struct SetupContext {
    api_client: reqwest::Client,
    proxy_client: reqwest::Client,
    server_listener: std::net::TcpListener,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
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
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
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
        }))
        .pool_max_idle_per_host(20)
        .build()
        .expect("Failed to build streaming proxy HTTP client")
}

fn create_bootstrap_context() -> Option<BootstrapContext> {
    let process_instance = acquire_process_instance()?;
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let server_listener = server::bind_local_listener(3002)
        .expect("Failed to bind local API server to a loopback port");
    let local_server_port = server_listener
        .local_addr()
        .map(|address| address.port())
        .expect("Failed to determine local API server port");
    if local_server_port != 3002 {
        log::warn!(
            "Local API port 3002 is unavailable; using 127.0.0.1:{}",
            local_server_port
        );
    }
    Some(BootstrapContext {
        process_instance,
        shutdown_rx,
        server_listener,
        local_server_port,
        api_client: build_api_client(),
        download_client: build_download_client(),
        proxy_client: build_proxy_client(),
        lifecycle: AppLifecycleState {
            is_quitting: Arc::new(AtomicBool::new(false)),
            shutdown_tx,
        },
    })
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

fn setup_application(
    app: &mut tauri::App,
    context: SetupContext,
) -> Result<(), Box<dyn std::error::Error>> {
    app.handle().plugin(tauri_plugin_dialog::init())?;
    let recommendation_service =
        RecommendationService::new(app.handle().clone(), context.api_client.clone())
            .map_err(std::io::Error::other)?;
    if let Err(error) = recommendation_service.start_startup_recommendation_job() {
        log::error!("启动智能推荐预热失败: {}", error);
    }
    app.manage(recommendation_service);
    if cfg!(debug_assertions) {
        app.handle().plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )?;
    }
    configure_tray(app)?;
    tauri::async_runtime::spawn(server::start_server(
        app.handle().clone(),
        server::ServerState {
            api_client: context.api_client,
            proxy_client: context.proxy_client,
        },
        context.server_listener,
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
            persist_desktop_lyric_bounds_in_background(window);
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
    let setup_context = SetupContext {
        api_client: context.api_client.clone(),
        proxy_client: context.proxy_client,
        server_listener: context.server_listener,
        shutdown_rx: context.shutdown_rx,
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(context.process_instance)
        .manage(context.lifecycle)
        .manage(LocalServerState {
            port: context.local_server_port,
        })
        .manage(context.api_client)
        .manage(DownloadClient(context.download_client))
        .manage(DownloadTaskRegistry::default())
        .manage(DesktopLyricBoundsSaveState::default())
        .invoke_handler(tauri::generate_handler![
            downloads::transfer::download_song_to_local,
            downloads::transfer::cancel_download,
            downloads::commands::scan_download_dir,
            downloads::commands::save_download_meta,
            downloads::commands::delete_download_file,
            downloads::commands::resolve_local_playback,
            system_commands::relay_player_control,
            system_commands::open_external_url,
            downloads::commands::open_download_dir,
            downloads::commands::get_download_dir,
            downloads::commands::get_default_download_dir,
            downloads::commands::select_download_dir,
            updater::check_for_update,
            updater::download_and_install_update,
            system_commands::get_local_server_port,
            recommendation_commands::log_recommendation_event,
            recommendation_commands::sync_recommendation_library,
            recommendation_commands::get_home_recommendations,
            recommendation_commands::get_similar_songs,
            recommendation_commands::start_recommendation_job,
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
            desktop_lyric::show_desktop_lyric_window,
            desktop_lyric::hide_desktop_lyric_window
        ])
        .on_window_event(handle_desktop_lyric_event)
        .setup(move |app| setup_application(app, setup_context))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let Some(context) = create_bootstrap_context() else {
        return;
    };
    build_application(context).run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<AppLifecycleState>() {
                let _ = state.shutdown_tx.send(true);
            }
        }
        _ => {}
    });
}
