use axum::{
    extract::{DefaultBodyLimit, Query, Request, State},
    http::{header::HOST, HeaderMap, HeaderName, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get},
    Json, Router,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener as StdTcpListener};
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Request header carrying the per-launch access token.
///
/// Media elements (`<audio src>`) cannot set request headers, so the same
/// token is also accepted through the `token=` query parameter.
pub const LOCAL_TOKEN_HEADER: &str = "x-tunefree-token";

/// Shared state for the local API server.
///
/// API resolution requests use a bounded whole-request timeout, while the
/// proxy client intentionally has no whole-request timeout so long-running
/// audio streams are not terminated mid-playback.
#[derive(Clone)]
pub struct ServerState {
    pub api_client: Client,
    pub proxy_client: Client,
    /// Per-launch random token required by all `/api/*` routes.
    pub token: String,
    /// Actual loopback port the listener is bound to (used for Host checks).
    pub port: u16,
}

/// Binds an OS-assigned loopback port for the local API server.
///
/// The port is randomized on every launch so other local pages cannot
/// predict the server address. Binding happens before the Tauri frontend
/// starts, allowing the actual port to be exposed synchronously through
/// managed state without event races.
pub fn bind_local_listener() -> std::io::Result<StdTcpListener> {
    let listener = StdTcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
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

/// Maps a provider error to caller-facing text.
///
/// Network errors from reqwest may embed upstream hostnames, ports, or DNS
/// resolver details; those are logged by the caller and replaced here with a
/// generic message so internals never reach the response body.
fn public_error_message(error: &crate::api::ApiError) -> String {
    match error {
        crate::api::ApiError::Network(_) => "上游音源请求失败".to_string(),
        other => other.to_string(),
    }
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
            Err(e) => {
                log::warn!(
                    "URL resolution failed for platform {}: {}",
                    query.platform,
                    e
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(UrlResponse {
                        url: None,
                        error: Some(public_error_message(&e)),
                    }),
                )
            }
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

/// Response body for the `/api/allowed-hosts` endpoint.
#[derive(Serialize)]
pub struct AllowedHostsResponse {
    /// Hostnames the CORS proxy will forward requests to.
    pub hosts: Vec<&'static str>,
}

/// Returns the CORS-proxy host whitelist so the frontend can self-check at
/// startup instead of maintaining a manually synchronized copy.
async fn handle_allowed_hosts() -> impl IntoResponse {
    Json(AllowedHostsResponse {
        hosts: crate::api::proxy::allowed_hosts().to_vec(),
    })
}

/// Simple health-check endpoint returning `200 OK "healthy"`.
async fn health_check() -> impl IntoResponse {
    (StatusCode::OK, "healthy")
}

/// Reason a request failed the local authentication checks.
#[derive(Debug, PartialEq, Eq)]
enum AuthRejection {
    BadHost,
    BadToken,
}

/// Compares two byte strings in time independent of where they differ,
/// so token probing cannot exploit early-exit timing.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= usize::from(x ^ y);
    }
    diff == 0
}

/// Extracts the percent-decoded value of `name` from a raw query string.
fn query_param(query: &str, name: &str) -> Option<String> {
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

/// Validates the Host header and access token of a protected request.
///
/// The Host allowlist defeats DNS-rebinding attacks (a rebound hostname
/// still carries the attacker's Host header), while the per-launch token
/// stops other local pages from calling the API even if they discover the
/// randomized port. The token is accepted from the `x-tunefree-token`
/// header or the `token` query parameter (either one suffices).
fn validate_local_request(
    headers: &HeaderMap,
    query: Option<&str>,
    port: u16,
    token: &str,
) -> Result<(), AuthRejection> {
    let host_ok = headers
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| {
            host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")
        });
    if !host_ok {
        return Err(AuthRejection::BadHost);
    }

    let header_ok = headers
        .get(LOCAL_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| constant_time_eq(value.as_bytes(), token.as_bytes()));
    let query_ok = query
        .and_then(|raw| query_param(raw, "token"))
        .is_some_and(|value| constant_time_eq(value.as_bytes(), token.as_bytes()));
    if header_ok || query_ok {
        Ok(())
    } else {
        Err(AuthRejection::BadToken)
    }
}

/// Builds a 403 response with a JSON body that states the failure category
/// without echoing request details.
fn forbidden(message: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({ "error": message })),
    )
        .into_response()
}

/// Axum middleware guarding all `/api/*` routes; `/health` is exempt.
async fn require_local_auth(
    State(state): State<ServerState>,
    request: Request,
    next: Next,
) -> Response {
    let outcome = validate_local_request(
        request.headers(),
        request.uri().query(),
        state.port,
        &state.token,
    );
    match outcome {
        Ok(()) => next.run(request).await,
        Err(AuthRejection::BadHost) => forbidden("请求来源不被本地服务器接受"),
        Err(AuthRejection::BadToken) => forbidden("缺少有效的本地访问令牌"),
    }
}

/// Returns the CORS origin whitelist. Dev-server origins are only trusted
/// in debug builds; release accepts the Tauri origins alone.
fn allowed_origins() -> Vec<axum::http::HeaderValue> {
    let mut origins = vec![
        axum::http::HeaderValue::from_static("tauri://localhost"),
        axum::http::HeaderValue::from_static("http://tauri.localhost"),
    ];
    if cfg!(debug_assertions) {
        origins.push(axum::http::HeaderValue::from_static(
            "http://127.0.0.1:3101",
        ));
        origins.push(axum::http::HeaderValue::from_static(
            "http://localhost:3101",
        ));
    }
    origins
}

/// Builds the CORS layer restricting browsers to known frontend origins.
fn build_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(allowed_origins()))
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
            HeaderName::from_static(LOCAL_TOKEN_HEADER),
        ])
        .expose_headers([
            HeaderName::from_static("accept-ranges"),
            HeaderName::from_static("content-range"),
            HeaderName::from_static("content-length"),
            HeaderName::from_static("content-type"),
            HeaderName::from_static("etag"),
            HeaderName::from_static("last-modified"),
        ])
}

/// Assembles the router: protected `/api/*` routes behind the auth
/// middleware, plus the unauthenticated `/health` probe.
fn build_router(state: ServerState) -> Router {
    let protected = Router::new()
        .route("/api/url", get(handle_url))
        .route("/api/cors-proxy", any(crate::api::proxy::handle_cors_proxy))
        .route("/api/allowed-hosts", get(handle_allowed_hosts))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_local_auth,
        ));

    Router::new()
        .merge(protected)
        .route("/health", get(health_check))
        .layer(build_cors_layer())
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024))
        .with_state(state)
}

/// Starts the local Axum web server for resolving music APIs and proxying CORS requests.
///
/// The listener is bound before Tauri initialization so the actual port is
/// already available through managed state when the frontend starts.
///
/// # Arguments
/// * `state` - Clients plus the per-launch token and bound port.
/// * `listener` - Pre-bound non-blocking loopback listener.
/// * `shutdown_rx` - Watch channel receiver; the server shuts down gracefully
///   when the value changes to `true`.
pub async fn start_server(
    state: ServerState,
    listener: StdTcpListener,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
) {
    let port = state.port;
    let app = build_router(state);

    let listener = tokio::net::TcpListener::from_std(listener)
        .expect("Failed to register local server listener with Tokio");

    log::info!("Server listening on 127.0.0.1:{}", port);

    let serve = axum::serve(listener, app).with_graceful_shutdown(async move {
        let _ = shutdown_rx.changed().await;
        log::info!("Server shutting down gracefully");
    });

    if let Err(e) = serve.await {
        log::error!("Server error: {}", e);
    }
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
