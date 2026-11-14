use reqwest::Client;
use serde_json::Value;

use super::model::{invalid_response, Platform};
use crate::app::error::{CommandError, CommandResult};

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

pub(super) fn client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .connect_timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("platform HTTP client configuration is valid")
}

pub(super) async fn read_response(response: reqwest::Response) -> CommandResult<Value> {
    if response.status().is_redirection() {
        return Err(CommandError::network(
            "平台请求被重定向，请重新登录或稍后重试",
        ));
    }
    let mut response = response
        .error_for_status()
        .map_err(|_| CommandError::network("平台请求失败，请稍后重试"))?;
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| CommandError::network("平台响应读取失败，请稍后重试"))?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(invalid_response());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| invalid_response())
}

pub(super) async fn netease_get(
    client: &Client,
    cookie: &str,
    path: &str,
    query: &[(&str, String)],
) -> CommandResult<Value> {
    let response = client
        .get(format!("https://music.163.com{path}"))
        .header("Cookie", cookie)
        .header("Referer", Platform::Netease.login_url())
        .header("User-Agent", "Mozilla/5.0")
        .query(query)
        .send()
        .await
        .map_err(|_| CommandError::network("网易云请求失败，请稍后重试"))?;
    let value = read_response(response).await?;
    check_netease(&value)?;
    Ok(value)
}

pub(super) fn check_netease(value: &Value) -> CommandResult<()> {
    match value["code"].as_i64() {
        Some(200) => Ok(()),
        Some(301 | 302 | 401 | 403) => Err(super::model::auth_required()),
        _ => Err(invalid_response()),
    }
}

pub(super) async fn qq_request(
    client: &Client,
    cookie: &str,
    module: &str,
    method: &str,
    param: Value,
) -> CommandResult<Value> {
    let response = client.post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header("Cookie", cookie).header("Referer", "https://y.qq.com/").header("Origin", "https://y.qq.com")
        .header("User-Agent", "Mozilla/5.0").json(&serde_json::json!({
            "comm": super::cookies::qq_request_comm(cookie), "req": { "module": module, "method": method, "param": param },
        })).send().await.map_err(|_| CommandError::network("QQ 音乐请求失败，请稍后重试"))?;
    let value = read_response(response).await?;
    qq_data(value)
}

pub(super) fn qq_data(value: Value) -> CommandResult<Value> {
    let codes = [value["code"].as_i64(), value["req"]["code"].as_i64()];
    if codes
        .iter()
        .any(|code| matches!(code, Some(1000 | 2000 | 2001 | 10004)))
    {
        return Err(super::model::auth_required());
    }
    if codes != [Some(0), Some(0)] || !value["req"]["data"].is_object() {
        return Err(invalid_response());
    }
    Ok(value["req"]["data"].clone())
}

#[cfg(test)]
#[path = "__tests__/http.rs"]
mod tests;
