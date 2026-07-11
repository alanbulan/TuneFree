use crate::server::ServerState;
use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{HeaderMap, HeaderName, Method, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::collections::HashSet;

const FORWARDED_REQUEST_HEADERS: [&str; 6] = [
    "content-type",
    "accept",
    "range",
    "if-range",
    "if-none-match",
    "if-modified-since",
];

const BLOCKED_RESPONSE_HEADERS: [&str; 13] = [
    "connection",
    "keep-alive",
    "proxy-connection",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "set-cookie",
    "set-cookie2",
    "access-control-allow-origin",
    "access-control-allow-credentials",
];

fn collect_forwarded_request_headers(headers: &HeaderMap) -> HeaderMap {
    let mut forwarded = HeaderMap::new();
    for name in FORWARDED_REQUEST_HEADERS {
        if let Some(value) = headers.get(name) {
            forwarded.insert(HeaderName::from_static(name), value.clone());
        }
    }
    forwarded
}

fn connection_header_tokens(headers: &HeaderMap) -> HashSet<String> {
    headers
        .get_all("connection")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

fn should_forward_response_header(name: &HeaderName, connection_tokens: &HashSet<String>) -> bool {
    let normalized = name.as_str();
    !BLOCKED_RESPONSE_HEADERS.contains(&normalized)
        && !connection_tokens.contains(normalized)
        && !normalized.starts_with("access-control-")
}

/// Whitelist of host domains allowed through the CORS proxy.
///
/// Only requests to these hosts (or their subdomains) are permitted.
/// This prevents the proxy from being used as an open relay.
const ALLOWED_HOSTS: [&str; 22] = [
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
pub(crate) fn is_allowed_host(host: &str) -> bool {
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
    State(state): State<ServerState>,
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
        None => return (StatusCode::BAD_REQUEST, "Target URL missing host").into_response(),
    };

    if !is_allowed_host(host) {
        return (StatusCode::FORBIDDEN, format!("Host not allowed: {}", host)).into_response();
    }

    // Prepare forward request
    let mut req_builder = state
        .proxy_client
        .request(method.clone(), parsed_url.clone());

    for (name, value) in collect_forwarded_request_headers(&headers) {
        if let Some(name) = name {
            req_builder = req_builder.header(name, value);
        }
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

    if host == "music-api.gdstudio.xyz"
        || host == "music.gdstudio.org"
        || host == "music-api.gdstudio.org"
    {
        req_builder = req_builder.header("Accept", "application/json,text/plain,*/*");
    }

    // Set body if method is not GET/HEAD
    if method != Method::GET && method != Method::HEAD {
        req_builder = req_builder.body(body);
    }

    match req_builder.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);

            // Preserve media/cache headers while excluding hop-by-hop, cookie,
            // and upstream CORS headers. The local CorsLayer owns CORS policy.
            let mut response_headers = HeaderMap::new();
            let connection_tokens = connection_header_tokens(resp.headers());
            for (k, v) in resp.headers().iter() {
                if should_forward_response_header(k, &connection_tokens) {
                    response_headers.insert(k.clone(), v.clone());
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn forwards_media_range_and_condition_headers_only() {
        let mut headers = HeaderMap::new();
        headers.insert("range", HeaderValue::from_static("bytes=1024-2047"));
        headers.insert("if-range", HeaderValue::from_static("etag-value"));
        headers.insert("cookie", HeaderValue::from_static("session=secret"));
        headers.insert("host", HeaderValue::from_static("127.0.0.1:3002"));

        let forwarded = collect_forwarded_request_headers(&headers);

        assert_eq!(forwarded.get("range").unwrap(), "bytes=1024-2047");
        assert_eq!(forwarded.get("if-range").unwrap(), "etag-value");
        assert!(forwarded.get("cookie").is_none());
        assert!(forwarded.get("host").is_none());
    }

    #[test]
    fn preserves_partial_content_headers_and_filters_hop_by_hop_headers() {
        let connection_tokens = HashSet::new();
        assert!(should_forward_response_header(
            &HeaderName::from_static("content-range"),
            &connection_tokens,
        ));
        assert!(should_forward_response_header(
            &HeaderName::from_static("accept-ranges"),
            &connection_tokens,
        ));
        assert!(!should_forward_response_header(
            &HeaderName::from_static("transfer-encoding"),
            &connection_tokens,
        ));
        assert!(!should_forward_response_header(
            &HeaderName::from_static("set-cookie"),
            &connection_tokens,
        ));
        assert!(!should_forward_response_header(
            &HeaderName::from_static("access-control-allow-origin"),
            &connection_tokens,
        ));
    }

    #[test]
    fn filters_headers_named_by_connection() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "connection",
            HeaderValue::from_static("keep-alive, x-internal"),
        );
        let tokens = connection_header_tokens(&headers);

        assert!(!should_forward_response_header(
            &HeaderName::from_static("x-internal"),
            &tokens,
        ));
    }
}
