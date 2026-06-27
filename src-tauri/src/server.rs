use axum::{
    extract::{DefaultBodyLimit, Query, State},
    http::{HeaderName, Method, StatusCode},
    response::IntoResponse,
    routing::{any, get},
    Json, Router,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tauri::Emitter;
use tower_http::cors::CorsLayer;

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
    State(client): State<Client>,
    Query(query): Query<UrlQuery>,
) -> impl IntoResponse {
    let quality = query.quality.clone().unwrap_or_else(|| "128k".to_string());

    match crate::api::get_provider(&query.platform) {
        Some(provider) => match provider.get_url(&client, &query.id, &quality).await {
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
/// The server binds to `127.0.0.1:3002` by default. If that port is unavailable,
/// it falls back to an OS-assigned port (port 0) and emits the actual port
/// to the frontend via the `server-port` event. If binding fails entirely,
/// the function panics with a clear error message.
///
/// # Arguments
/// * `app_handle` - Tauri app handle for emitting the server port event.
/// * `client` - Shared `reqwest::Client` for all HTTP requests.
/// * `shutdown_rx` - Watch channel receiver; the server shuts down gracefully
///   when the value changes to `true`.
pub async fn start_server(
    app_handle: tauri::AppHandle,
    client: reqwest::Client,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
) {
    // Restrict CORS to known frontend origins
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:3001"
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
        ]);

    let app = Router::new()
        .route("/api/url", get(handle_url))
        .route("/api/cors-proxy", any(crate::api::proxy::handle_cors_proxy))
        .route("/health", get(health_check))
        .layer(cors)
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024))
        .with_state(client);

    // Try the preferred port (3002), fall back to OS-assigned port
    let preferred_addr = SocketAddr::from(([127, 0, 0, 1], 3002));
    let listener = match tokio::net::TcpListener::bind(preferred_addr).await {
        Ok(listener) => listener,
        Err(e) => {
            log::error!(
                "Failed to bind to {}: {}, trying OS-assigned port",
                preferred_addr,
                e
            );
            tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .unwrap_or_else(|e| panic!("Failed to bind to any port: {}", e))
        }
    };

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
