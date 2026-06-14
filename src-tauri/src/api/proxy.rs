use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
};
use reqwest::Client;
use serde::Deserialize;
use std::str::FromStr;

const ALLOWED_HOSTS: [&str; 20] = [
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
    "tunehub.sayqz.com",
    "hdslb.com",
];

fn is_allowed(host: &str) -> bool {
    ALLOWED_HOSTS.iter().any(|&allowed| {
        host == allowed || host.ends_with(&format!(".{}", allowed))
    })
}

#[derive(Deserialize)]
pub struct ProxyQuery {
    pub url: String,
}

pub async fn handle_cors_proxy(
    State(client): State<Client>,
    method: Method,
    headers: HeaderMap,
    Query(query): Query<ProxyQuery>,
    body: Bytes,
) -> impl IntoResponse {
    let target_url = query.url;
    let parsed_url = match reqwest::Url::parse(&target_url) {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid target URL").into_response(),
    };

    let host = match parsed_url.host_str() {
        Some(h) => h,
        None => return (StatusCode::BAD_REQUEST, "Target URL missing host").into_response(),
    };

    if !is_allowed(host) {
        return (StatusCode::FORBIDDEN, format!("Host not allowed: {}", host)).into_response();
    }

    // Prepare forward request
    let mut req_builder = client.request(method.clone(), parsed_url.clone());

    // Pass through Content-Type if present
    if let Some(ct) = headers.get("content-type") {
        req_builder = req_builder.header("content-type", ct);
    }

    // Generic desktop user agent
    req_builder = req_builder.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36");
    
    // Origin or Host as Referer
    if let Some(origin) = parsed_url.origin().unicode_serialization().into() {
        req_builder = req_builder.header("Referer", origin);
    } else {
        req_builder = req_builder.header("Referer", target_url.clone());
    }

    // Special referral rules matching JS
    if host == "music-api.gdstudio.xyz" {
        req_builder = req_builder.header("Accept", "application/json,text/plain,*/*");
        req_builder = req_builder.header("Referer", "https://music.gdstudio.xyz/");
    } else if host == "hdslb.com" || host.ends_with(".hdslb.com") {
        req_builder = req_builder.header("Referer", "https://www.bilibili.com/");
    } else if host == "u.y.qq.com" || host == "c.y.qq.com" || host.ends_with(".y.qq.com") {
        req_builder = req_builder.header("Referer", "https://y.qq.com/");
    }

    // Set body if method is not GET/HEAD
    if method != Method::GET && method != Method::HEAD {
        req_builder = req_builder.body(body);
    }

    match req_builder.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let mut response_headers = HeaderMap::new();

            // Copy headers from downstream response
            for (k, v) in resp.headers().iter() {
                // Skip content-encoding to avoid browser decompression issues
                if k != "content-encoding" && k != "content-length" {
                    if let Ok(name) = axum::http::HeaderName::from_str(k.as_str()) {
                        response_headers.insert(name, v.clone());
                    }
                }
            }

            // Set CORS headers
            response_headers.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
            response_headers.insert("Access-Control-Allow-Methods", HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS"));
            response_headers.insert("Access-Control-Allow-Headers", HeaderValue::from_static("Content-Type, Authorization"));

            let bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => return (StatusCode::BAD_GATEWAY, format!("Failed reading response: {}", e)).into_response(),
            };

            Response::builder()
                .status(status)
                .body(axum::body::Body::from(bytes))
                .unwrap()
                .into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("Proxy fetch failed: {}", e)).into_response(),
    }
}
