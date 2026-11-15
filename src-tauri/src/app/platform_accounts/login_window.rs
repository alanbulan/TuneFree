use super::{
    cookies,
    model::{Platform, PlatformLoginAttempt},
    PlatformAccountState,
};
use crate::app::error::CommandResult;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn navigation(
    app: AppHandle,
    platform: Platform,
    label: String,
) -> impl Fn(&url::Url) -> bool + Send + 'static {
    move |url| {
        if let Some(upgraded) = cookies::https_callback(platform, url) {
            // on_navigation can run in the native UI callback; navigate after it returns.
            let app = app.clone();
            let label = label.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.navigate(upgraded);
                }
            });
            return false;
        }
        url.as_str() == "about:blank" || cookies::login_navigation(platform, url)
    }
}

pub(super) fn open(app: &AppHandle, platform: Platform) -> CommandResult<WebviewWindow> {
    let popup_app = app.clone();
    let root_label = platform.window_label();
    let window = WebviewWindowBuilder::new(
        app,
        &root_label,
        WebviewUrl::External(platform.login_url().parse().expect("fixed login URL")),
    )
    .title(platform.title())
    .inner_size(920.0, 700.0)
    .min_inner_size(700.0, 540.0)
    .center()
    .incognito(true)
    .disable_drag_drop_handler()
    .on_navigation(navigation(app.clone(), platform, root_label))
    .on_new_window(move |url, features| {
        if url.as_str() != "about:blank"
            && !cookies::login_navigation(platform, &url)
            && cookies::https_callback(platform, &url).is_none()
        {
            return tauri::webview::NewWindowResponse::Deny;
        }
        let label = format!("{}-popup", platform.window_label());
        if let Some(previous) = popup_app.get_webview_window(&label) {
            let _ = previous.close();
        }
        let popup = WebviewWindowBuilder::new(
            &popup_app,
            &label,
            WebviewUrl::External("about:blank".parse().expect("fixed URL")),
        )
        .title(platform.title())
        .inner_size(720.0, 650.0)
        .center()
        .incognito(true)
        // Tauri preserves the opener's WK configuration / WebView2 environment here.
        .window_features(features)
        .disable_drag_drop_handler()
        .on_navigation(navigation(popup_app.clone(), platform, label))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build();
        match popup {
            Ok(window) => tauri::webview::NewWindowResponse::Create { window },
            Err(_) => tauri::webview::NewWindowResponse::Deny,
        }
    })
    .build()?;
    Ok(window)
}

pub(super) fn close(app: &AppHandle, platform: Platform) -> CommandResult<()> {
    for label in [
        format!("{}-popup", platform.window_label()),
        platform.window_label(),
    ] {
        if let Some(window) = app.get_webview_window(&label) {
            window.close()?;
        }
    }
    Ok(())
}

pub(super) fn monitor(
    app: &AppHandle,
    state: &PlatformAccountState,
    platform: Platform,
    window: &WebviewWindow,
    attempt: &PlatformLoginAttempt,
) {
    let watched_state = state.clone();
    let watched_id = attempt.attempt_id.clone();
    let watched_app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let state = watched_state.clone();
            let id = watched_id.clone();
            let app = watched_app.clone();
            tauri::async_runtime::spawn(async move {
                let _guard = state.0.operations.lock().await;
                if state.attempt(platform, &id).is_ok() {
                    state.invalidate(platform);
                }
                if let Some(popup) =
                    app.get_webview_window(&format!("{}-popup", platform.window_label()))
                {
                    let _ = popup.close();
                }
            });
        }
    });
    let app = app.clone();
    let state = state.clone();
    let id = attempt.attempt_id.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(10 * 60)).await;
        let _guard = state.0.operations.lock().await;
        if state.attempt(platform, &id).is_ok() {
            state.invalidate(platform);
            let _ = close(&app, platform);
        }
    });
}
