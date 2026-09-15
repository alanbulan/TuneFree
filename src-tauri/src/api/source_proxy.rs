use crate::server::{ServerState, LOCAL_TOKEN_HEADER};
use axum::{
    extract::State,
    http::{HeaderMap, HeaderName, Method, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::Duration;

#[path = "source_proxy_target.rs"]
mod target;
pub(crate) use target::{is_public_target, PublicDnsResolver};

/// 单次源请求的默认时长上限；脚本可以用 `timeoutMs` 收紧，但不会超过 [`MAX_SOURCE_TIMEOUT_MS`]。
const DEFAULT_SOURCE_TIMEOUT: Duration = Duration::from_secs(30);
const MIN_SOURCE_TIMEOUT_MS: u64 = 500;
const MAX_SOURCE_TIMEOUT_MS: u64 = 60_000;

/// 响应体上限。音源脚本只消费 JSON/文本接口，音频流不走这条链路。
const MAX_SOURCE_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

/// 由本地服务接管、绝不透传给上游的请求头。
///
/// `accept-encoding` 被剔除是因为本地 HTTP 客户端不启用压缩解码，
/// 必须让上游返回明文；长度头由 reqwest 依据实际 body 重算。
const BLOCKED_REQUEST_HEADERS: [&str; 10] = [
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "proxy-connection",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "accept-encoding",
];

/// 不回传给沙箱的响应头。
///
/// `set-cookie` 由信封的 `cookies` 字段单独承载（浏览器里 JS 读不到它）；
/// `content-length` 随信封改变而失效；`access-control-*` 归本地 CORS 层所有。
const BLOCKED_RESPONSE_HEADERS: [&str; 12] = [
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
    "content-length",
];

/// 允许脚本使用的请求方法；其余方法一律拒绝。
const ALLOWED_METHODS: [&str; 6] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

/// 请求信封：浏览器无法设置 User-Agent / Referer / Cookie 等禁止头，
/// 因此这些头必须经由 JSON 传到 Rust 侧再落到真实请求上。
#[derive(Deserialize)]
pub struct SourceProxyRequest {
    /// 目标 URL（自定义音源脚本想要访问的任意公网地址）。
    pub url: String,
    /// HTTP 方法，默认 GET。
    #[serde(default)]
    pub method: Option<String>,
    /// 脚本请求头（小写或原样均可）。
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// 请求体，base64 承载以支持二进制。
    #[serde(rename = "bodyBase64", default)]
    pub body_base64: Option<String>,
    /// 单次请求超时（毫秒），受服务端上下限约束。
    #[serde(rename = "timeoutMs", default)]
    pub timeout_ms: Option<u64>,
}

/// 回传给沙箱的响应信封。
///
/// 统一用 base64 承载响应体，脚本侧再按内容类型解码，
/// 这样二进制、JSON、文本三条路径共用一种信道。
#[derive(Serialize)]
pub struct SourceProxyResponse {
    pub status: u16,
    #[serde(rename = "statusText")]
    pub status_text: String,
    /// 小写头名到值的映射，重复头按 HTTP 语义用 `, ` 连接。
    pub headers: BTreeMap<String, String>,
    /// 原始 `set-cookie` 值，顺序保留。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub cookies: Vec<String>,
    #[serde(rename = "bodyBase64")]
    pub body_base64: String,
}

/// 源代理失败分类，只用于日志与对外错误码。
enum SourceProxyError {
    Upstream(reqwest::Error),
    TooLarge,
}

fn is_blocked_request_header(name: &str) -> bool {
    name == LOCAL_TOKEN_HEADER || BLOCKED_REQUEST_HEADERS.contains(&name)
}

fn is_blocked_response_header(name: &str, connection_tokens: &[String]) -> bool {
    BLOCKED_RESPONSE_HEADERS.contains(&name)
        || name.starts_with("access-control-")
        || connection_tokens.iter().any(|token| token == name)
}

/// 解析上游响应里 `Connection` 头点名的逐跳字段，这些字段必须一并剔除。
fn connection_tokens(headers: &HeaderMap) -> Vec<String> {
    headers
        .get_all("connection")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

/// 把信封当作上游响应的完整替身读进来。
///
/// 逐块读取并累计，任何超过上限的响应都会中断连接，避免恶意上游撑爆内存。
async fn collect_source_response(
    response: reqwest::Response,
) -> Result<SourceProxyResponse, SourceProxyError> {
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let tokens = connection_tokens(response.headers());
    let mut headers: BTreeMap<String, String> = BTreeMap::new();
    let mut cookies = Vec::new();

    for (name, value) in response.headers().iter() {
        let name = name.as_str();
        if name == "set-cookie" {
            if let Ok(text) = value.to_str() {
                cookies.push(text.to_string());
            }
            continue;
        }
        if is_blocked_response_header(name, &tokens) {
            continue;
        }
        let Ok(text) = value.to_str() else { continue };
        match headers.get_mut(name) {
            Some(existing) => {
                existing.push_str(", ");
                existing.push_str(text);
            }
            None => {
                headers.insert(name.to_string(), text.to_string());
            }
        }
    }

    let mut reader = response;
    let mut body: Vec<u8> = Vec::new();
    loop {
        let chunk = reader.chunk().await.map_err(SourceProxyError::Upstream)?;
        let Some(chunk) = chunk else { break };
        if body.len() + chunk.len() > MAX_SOURCE_RESPONSE_BYTES {
            return Err(SourceProxyError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }

    Ok(SourceProxyResponse {
        status: status.as_u16(),
        status_text,
        headers,
        cookies,
        body_base64: BASE64_STANDARD.encode(&body),
    })
}

fn resolve_method(raw: Option<&String>) -> Option<Method> {
    let text = match raw {
        Some(value) => value.trim().to_ascii_uppercase(),
        None => return Some(Method::GET),
    };
    if !ALLOWED_METHODS.contains(&text.as_str()) {
        return None;
    }
    Method::from_bytes(text.as_bytes()).ok()
}

fn resolve_timeout(requested: Option<u64>) -> Duration {
    match requested {
        Some(value) => {
            Duration::from_millis(value.clamp(MIN_SOURCE_TIMEOUT_MS, MAX_SOURCE_TIMEOUT_MS))
        }
        None => DEFAULT_SOURCE_TIMEOUT,
    }
}

/// 处理自定义音源的 HTTP 转发请求。
///
/// 与 `/api/cors-proxy` 的区别：这里面向用户导入的第三方音源脚本，
/// 目标是任意公网主机，请求头（含 User-Agent / Referer / Cookie）由脚本
/// 通过 JSON 信封指定，不再由本地服务改写；安全性由「仅公网目标」这一条约束保证。
pub async fn handle_source_proxy(
    State(state): State<ServerState>,
    Json(payload): Json<SourceProxyRequest>,
) -> Response {
    let Ok(target) = Url::parse(&payload.url) else {
        return error_response(StatusCode::BAD_REQUEST, "目标 URL 无法解析");
    };
    if !is_public_target(&target) {
        let host = target.host_str().unwrap_or("").to_string();
        return error_response(
            StatusCode::FORBIDDEN,
            &format!("音源代理不允许访问该地址：{host}"),
        );
    }

    let Some(method) = resolve_method(payload.method.as_ref()) else {
        return error_response(StatusCode::BAD_REQUEST, "不支持的请求方法");
    };

    let body = match payload.body_base64.as_deref() {
        Some(text) => match BASE64_STANDARD.decode(text) {
            Ok(bytes) => bytes,
            Err(_) => return error_response(StatusCode::BAD_REQUEST, "请求体不是有效的 base64"),
        },
        None => Vec::new(),
    };

    let mut request = state.source_proxy_client.request(method.clone(), target);
    for (name, value) in &payload.headers {
        let name = name.to_ascii_lowercase();
        if is_blocked_request_header(&name) {
            continue;
        }
        // 非法头名直接跳过：宁缺勿滥，避免被畸形输入改写请求语义。
        if let Ok(header) = HeaderName::from_bytes(name.as_bytes()) {
            if let Ok(header_value) = reqwest::header::HeaderValue::from_str(value) {
                request = request.header(header, header_value);
            }
        }
    }
    if method != Method::GET && method != Method::HEAD && !body.is_empty() {
        request = request.body(body);
    }

    let timeout = resolve_timeout(payload.timeout_ms);
    let deadline = tokio::time::Instant::now() + timeout;
    let attempt = tokio::time::timeout_at(deadline, request.send()).await;
    let response = match attempt {
        Err(_) => return error_response(StatusCode::GATEWAY_TIMEOUT, "音源请求超时"),
        Ok(Err(error)) => {
            log::warn!("Source proxy upstream request failed: {}", error);
            return error_response(StatusCode::BAD_GATEWAY, "音源上游请求失败");
        }
        Ok(Ok(response)) => response,
    };

    match tokio::time::timeout_at(deadline, collect_source_response(response)).await {
        Err(_) => error_response(StatusCode::GATEWAY_TIMEOUT, "音源请求超时"),
        Ok(Ok(payload)) => (StatusCode::OK, Json(payload)).into_response(),
        Ok(Err(SourceProxyError::TooLarge)) => {
            log::warn!("Source proxy response exceeded size limit");
            error_response(StatusCode::BAD_GATEWAY, "音源响应体过大")
        }
        Ok(Err(SourceProxyError::Upstream(error))) => {
            log::warn!("Source proxy body read failed: {}", error);
            error_response(StatusCode::BAD_GATEWAY, "音源响应读取失败")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_public_targets() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.com/file",
            "http://localhost/admin",
            "http://api.localhost/ping",
            "http://router.local/setup",
            "http://127.0.0.1:3002/api/url",
            "http://127.1.2.3/",
            "http://[::1]/",
            "http://10.0.0.5/",
            "http://172.16.9.9/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data",
            "http://100.64.0.1/",
            "http://0.0.0.0/",
            "http://224.0.0.1/",
            "http://[fc00::1]/",
            "http://[fe80::1]/",
        ] {
            let parsed = Url::parse(url).unwrap();
            assert!(!is_public_target(&parsed), "{url} 不应被允许");
        }
    }

    #[test]
    fn allows_public_hosts_and_addresses() {
        for url in [
            "https://yy.zddyr.top/lx/api/url",
            "http://api.chksz.top:8080/x?y=1",
            "https://8.8.8.8/",
            "https://[2606:4700::1111]/",
        ] {
            let parsed = Url::parse(url).unwrap();
            assert!(is_public_target(&parsed), "{url} 应被允许");
        }
    }

    #[test]
    fn blocks_local_token_and_hop_by_hop_headers() {
        assert!(is_blocked_request_header(LOCAL_TOKEN_HEADER));
        assert!(is_blocked_request_header("accept-encoding"));
        assert!(is_blocked_request_header("content-length"));
        assert!(!is_blocked_request_header("user-agent"));
        assert!(!is_blocked_request_header("referer"));
        assert!(!is_blocked_request_header("cookie"));
    }

    #[test]
    fn drops_connection_named_response_headers() {
        let tokens = vec!["x-internal".to_string()];
        assert!(is_blocked_response_header("set-cookie", &tokens));
        assert!(is_blocked_response_header(
            "access-control-allow-origin",
            &tokens
        ));
        assert!(is_blocked_response_header("x-internal", &tokens));
        assert!(!is_blocked_response_header("content-type", &tokens));
        assert!(!is_blocked_response_header("etag", &tokens));
    }

    #[test]
    fn resolves_methods_and_clamps_timeouts() {
        assert_eq!(resolve_method(Some(&"get".to_string())), Some(Method::GET));
        assert_eq!(
            resolve_method(Some(&" POST ".to_string())),
            Some(Method::POST)
        );
        assert_eq!(resolve_method(Some(&"TRACE".to_string())), None);
        assert_eq!(resolve_method(None), Some(Method::GET));
        assert_eq!(resolve_timeout(None), DEFAULT_SOURCE_TIMEOUT);
        assert_eq!(
            resolve_timeout(Some(10)),
            Duration::from_millis(MIN_SOURCE_TIMEOUT_MS)
        );
        assert_eq!(
            resolve_timeout(Some(9_999_999)),
            Duration::from_millis(MAX_SOURCE_TIMEOUT_MS)
        );
        assert_eq!(resolve_timeout(Some(1_500)), Duration::from_millis(1_500));
    }
}

#[cfg(test)]
#[path = "__tests__/source_proxy_http.rs"]
mod http_tests;
