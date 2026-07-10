use axum::{
    extract::{DefaultBodyLimit, Query, State},
    http::{HeaderName, Method, StatusCode},
    response::IntoResponse,
    routing::{any, get},
    Json, Router,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener as StdTcpListener};
use tauri::Emitter;
use tower_http::cors::CorsLayer;

/// HTTP clients used by the local API server.
///
/// API resolution requests use a bounded whole-request timeout, while the
/// proxy client intentionally has no whole-request timeout so long-running
/// audio streams are not terminated mid-playback.
#[derive(Clone)]
pub struct ServerState {
    pub api_client: Client,
    pub proxy_client: Client,
}

/// Binds the preferred loopback port, falling back to an OS-assigned port.
///
/// Binding happens before the Tauri frontend starts, allowing the actual port
/// to be exposed synchronously through managed state without event races.
pub fn bind_local_listener(preferred_port: u16) -> std::io::Result<StdTcpListener> {
    let preferred_addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, preferred_port);
    let listener = StdTcpListener::bind(preferred_addr)
        .or_else(|_| StdTcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

/// Query parameters for the `/api/url` endpoint.
#[derive(Deserialize)]
pub struct UrlQuery {
    /// Music platform: "netease", "qq", "tencent", or "kuwo".
    pub platform: String,
    /// Song ID on the target platform.
    pub id: String,
    /// Desired audio quality (e.g. "128k", "320k", "flac"). Defaults to "128k".
    pub quality: Option<String>,
}

/// Response body for the `/api/url` endpoint.
#[derive(Serialize)]
pub struct UrlResponse {
    /// The resolved audio URL, if successful.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Error message, if the request failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Handles music URL resolution requests via the trait-based provider dispatch.
///
/// Looks up the appropriate `MusicProvider` for the requested platform,
/// resolves the audio URL, and returns it as JSON.
async fn handle_url(
    State(state): State<ServerState>,
    Query(query): Query<UrlQuery>,
) -> impl IntoResponse {
    let quality = query.quality.clone().unwrap_or_else(|| "128k".to_string());

    match crate::api::get_provider(&query.platform) {
        Some(provider) => match provider
            .get_url(&state.api_client, &query.id, &quality)
            .await
        {
            Ok(url) => (
                StatusCode::OK,
                Json(UrlResponse {
                    url: Some(url),
                    error: None,
                }),
            ),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(UrlResponse {
                    url: None,
                    error: Some(e.to_string()),
                }),
            ),
        },
        None => (
            StatusCode::BAD_REQUEST,
            Json(UrlResponse {
                url: None,
                error: Some(format!("Platform {} not supported", query.platform)),
            }),
        ),
    }
}

/// Simple health-check endpoint returning `200 OK "healthy"`.
async fn health_check() -> impl IntoResponse {
    (StatusCode::OK, "healthy")
}

/// Starts the local Axum web server for resolving music APIs and proxying CORS requests.
///
/// The listener is bound before Tauri initialization so the actual port is
/// already available through managed state when the frontend starts.
///
/// # Arguments
/// * `app_handle` - Tauri app handle for emitting the server port event.
/// * `state` - Separate API and streaming proxy HTTP clients.
/// * `listener` - Pre-bound non-blocking loopback listener.
/// * `shutdown_rx` - Watch channel receiver; the server shuts down gracefully
///   when the value changes to `true`.
pub async fn start_server(
    app_handle: tauri::AppHandle,
    state: ServerState,
    listener: StdTcpListener,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
) {
    // Restrict CORS to known frontend origins
    let cors = CorsLayer::new()
        .allow_origin([
            "http://127.0.0.1:3101"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://localhost:3101"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "tauri://localhost"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://tauri.localhost"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("authorization"),
            HeaderName::from_static("accept"),
            HeaderName::from_static("range"),
            HeaderName::from_static("if-range"),
            HeaderName::from_static("if-none-match"),
            HeaderName::from_static("if-modified-since"),
        ])
        .expose_headers([
            HeaderName::from_static("accept-ranges"),
            HeaderName::from_static("content-range"),
            HeaderName::from_static("content-length"),
            HeaderName::from_static("content-type"),
            HeaderName::from_static("etag"),
            HeaderName::from_static("last-modified"),
        ]);

    let app = Router::new()
        .route("/api/url", get(handle_url))
        .route("/api/cors-proxy", any(crate::api::proxy::handle_cors_proxy))
        .route("/health", get(health_check))
        .layer(cors)
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024))
        .with_state(state);

    let listener = tokio::net::TcpListener::from_std(listener)
        .expect("Failed to register local server listener with Tokio");

    let actual_port = listener
        .local_addr()
        .map(|addr| addr.port())
        .unwrap_or(3002);

    log::info!("Server listening on 127.0.0.1:{}", actual_port);
    let _ = app_handle.emit("server-port", actual_port);

    let serve = axum::serve(listener, app).with_graceful_shutdown(async move {
        let _ = shutdown_rx.changed().await;
        log::info!("Server shutting down gracefully");
    });

    if let Err(e) = serve.await {
        log::error!("Server error: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_local_listener_falls_back_when_preferred_port_is_occupied() {
        let occupied = StdTcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).unwrap();
        let occupied_port = occupied.local_addr().unwrap().port();

        let listener = bind_local_listener(occupied_port).unwrap();
        let actual_port = listener.local_addr().unwrap().port();

        assert_ne!(actual_port, occupied_port);
        assert_ne!(actual_port, 0);
    }
}
