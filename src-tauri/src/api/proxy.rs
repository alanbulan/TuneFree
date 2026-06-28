use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{HeaderMap, HeaderName, Method, StatusCode},
    response::{IntoResponse, Response},
};
use reqwest::Client;
use serde::Deserialize;
use std::str::FromStr;

/// Whitelist of host domains allowed through the CORS proxy.
///
/// Only requests to these hosts (or their subdomains) are permitted.
/// This prevents the proxy from being used as an open relay.
const ALLOWED_HOSTS: [&str; 21] = [
    "music.163.com",
    "interface.music.163.com",
    "interface3.music.163.com",
    "u.y.qq.com",
    "c.y.qq.com",
    "shc.y.qq.com",
    "y.gtimg.cn",
    "search.kuwo.cn",
    "www.kuwo.cn",
    "kuwo.cn",
    "artistpicserver.kuwo.cn",
    "kbangserver.kuwo.cn",
    "kwcdn.kuwo.cn",
    "mobi.kuwo.cn",
    "nmobi.kuwo.cn",
    "musicpay.kuwo.cn",
    "m.kuwo.cn",
    "music-api.gdstudio.xyz",
    "music.gdstudio.org",
    "music-api.gdstudio.org",
    "tunehub.sayqz.com",
    "hdslb.com",
];

/// Checks if `host` is in the allowed-hosts whitelist.
///
/// Matches exact hostnames and subdomains (e.g. "sub.kuwo.cn" matches "kuwo.cn").
/// Uses byte-level comparison to avoid string allocation per check.
fn is_allowed(host: &str) -> bool {
    ALLOWED_HOSTS.iter().any(|&allowed| {
        if host == allowed {
            return true;
        }
        // Check subdomain: host must end with allowed and have a dot separator
        host.len() > allowed.len()
            && host.ends_with(allowed)
            && host.as_bytes()[host.len() - allowed.len() - 1] == b'.'
    })
}

/// Query parameters for the CORS proxy endpoint.
#[derive(Deserialize)]
pub struct ProxyQuery {
    /// The target URL to proxy the request to.
    pub url: String,
}

/// Handles CORS proxy requests by forwarding them to the target URL
/// and returning the response with appropriate CORS headers.
///
/// The proxy enforces a host whitelist, sets platform-appropriate Referer
/// headers, and streams the response body to avoid buffering large responses
/// entirely in memory.
///
/// # Arguments
/// * `client` - Shared HTTP client (injected via axum State).
/// * `method` - HTTP method of the original request.
/// * `headers` - Original request headers.
/// * `query` - Query parameters containing the target URL.
/// * `body` - Request body bytes (forwarded for non-GET/HEAD methods).
///
/// # Returns
/// A streaming `Response` with CORS headers, or an error response.
pub async fn handle_cors_proxy(
    State(client): State<Client>,
    method: Method,
    headers: HeaderMap,
    Query(query): Query<ProxyQuery>,
    body: Bytes,
) -> Response {
    // Handle CORS preflight requests early
    if method == Method::OPTIONS {
        return (StatusCode::NO_CONTENT, "").into_response();
    }

    let target_url = query.url;
    let parsed_url = match reqwest::Url::parse(&target_url) {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid target URL").into_response(),
    };

    let host = match parsed_url.host_str() {
        Some(h) => h,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                "Target URL missing host",
            )
                .into_response()
        }
    };

    if !is_allowed(host) {
        return (
            StatusCode::FORBIDDEN,
            format!("Host not allowed: {}", host),
        )
            .into_response();
    }

    // Prepare forward request
    let mut req_builder = client.request(method.clone(), parsed_url.clone());

    // Pass through Content-Type if present
    if let Some(ct) = headers.get("content-type") {
        req_builder = req_builder.header("content-type", ct);
    }

    // Generic desktop user agent
    req_builder = req_builder.header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    );

    // Determine the Referer header value based on the target host
    let referer: String = match host {
        "music-api.gdstudio.xyz" | "music.gdstudio.org" | "music-api.gdstudio.org" => {
            "https://music.gdstudio.org/".into()
        }
        h if h == "hdslb.com" || h.ends_with(".hdslb.com") => "https://www.bilibili.com/".into(),
        h if h == "u.y.qq.com" || h == "c.y.qq.com" || h.ends_with(".y.qq.com") => {
            "https://y.qq.com/".into()
        }
        _ => parsed_url.origin().ascii_serialization(),
    };

    req_builder = req_builder.header("Referer", &referer);

    if host == "music-api.gdstudio.xyz" || host == "music.gdstudio.org" || host == "music-api.gdstudio.org" {
        req_builder = req_builder.header("Accept", "application/json,text/plain,*/*");
    }

    // Set body if method is not GET/HEAD
    if method != Method::GET && method != Method::HEAD {
        req_builder = req_builder.body(body);
    }

    match req_builder.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);

            // Collect downstream response headers (skip encoding/length for streaming)
            let mut response_headers = HeaderMap::new();
            for (k, v) in resp.headers().iter() {
                if k != "content-encoding" && k != "content-length" {
                    if let Ok(name) = HeaderName::from_str(k.as_str()) {
                        response_headers.insert(name, v.clone());
                    }
                }
            }

            // Stream the response body to avoid buffering in memory
            let stream = resp.bytes_stream();
            let mut response = Response::builder()
                .status(status)
                .body(axum::body::Body::from_stream(stream))
                .unwrap_or_else(|_| {
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(axum::body::Body::from("Failed to stream response"))
                        .unwrap()
                });

            // Apply collected headers to the response
            *response.headers_mut() = response_headers;
            response.into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("Proxy fetch failed: {}", e),
        )
            .into_response(),
    }
}
