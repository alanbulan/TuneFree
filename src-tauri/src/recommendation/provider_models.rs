use super::{privacy, OpenAiCompatibleProvider};

impl OpenAiCompatibleProvider {
    /// 使用相同的服务地址与凭据读取模型目录，不需要先选定模型。
    pub async fn list_models(
        &self,
        config: &super::LlmConfig,
        api_key: &str,
    ) -> Result<Vec<String>, String> {
        privacy::validate_base_url(&config.base_url)?;
        if api_key.trim().is_empty() {
            return Err("请先填写或保存 API Key，再获取模型列表".to_string());
        }
        tokio::time::timeout(
            std::time::Duration::from_millis(config.timeout_ms),
            self.request_models(config, api_key),
        )
        .await
        .unwrap_or_else(|_| Err("获取模型列表超时".to_string()))
    }

    async fn request_models(
        &self,
        config: &super::LlmConfig,
        api_key: &str,
    ) -> Result<Vec<String>, String> {
        let mut last_error = "模型服务未提供模型列表接口".to_string();
        for endpoint in Self::chat_completion_urls(&config.base_url) {
            let url = format!("{}/models", endpoint.trim_end_matches("/chat/completions"));
            let response = self
                .client
                .get(url)
                .bearer_auth(api_key)
                .send()
                .await
                .map_err(|error| format!("获取模型列表失败: {}", error.without_url()))?;
            let status = response.status();
            let text = response
                .text()
                .await
                .map_err(|_| "读取模型列表失败".to_string())?;
            let parsed = serde_json::from_str::<serde_json::Value>(&text);
            if !status.is_success() {
                let message = parsed
                    .as_ref()
                    .ok()
                    .and_then(|value| value.pointer("/error/message"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("模型列表接口返回错误");
                last_error = format!("获取模型列表失败（HTTP {}）：{}", status.as_u16(), message);
                if matches!(status.as_u16(), 404 | 405) {
                    continue;
                }
                return Err(last_error);
            }
            let value = parsed.map_err(|_| "模型列表接口没有返回合法 JSON".to_string())?;
            let data = value
                .get("data")
                .and_then(|value| value.as_array())
                .ok_or_else(|| "模型列表响应缺少 data 数组".to_string())?;
            let mut models: Vec<String> = data
                .iter()
                .filter_map(|item| item.get("id").and_then(|value| value.as_str()))
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .collect();
            models.sort();
            models.dedup();
            if models.is_empty() {
                return Err("服务商未返回可用模型，请检查账号权限".to_string());
            }
            return Ok(models);
        }
        Err(last_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        http::{HeaderMap, StatusCode, Uri},
        routing::get,
        Json, Router,
    };
    use parking_lot::Mutex;
    use serde_json::json;
    use std::sync::Arc;

    #[tokio::test]
    async fn model_list_uses_get_auth_and_normalizes_ids_for_all_supported_base_urls() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let calls = Arc::new(Mutex::new(Vec::new()));
        let requests = calls.clone();
        let app = Router::new().route("/v1/models", get(move |uri: Uri, headers: HeaderMap| {
            requests.lock().push(uri.path().to_string());
            async move {
                assert_eq!(headers["authorization"], "Bearer test-key");
                Json(json!({"data": [{"id":"z-model"}, {"id":"a-model"}, {"id":"a-model"}, {"id":""}, {}]}))
            }
        }));
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
        for suffix in ["", "/v1", "/v1/chat/completions"] {
            let config = super::super::request_tests::config(&format!("{base}{suffix}"), 1000);
            assert_eq!(
                provider.list_models(&config, "test-key").await.unwrap(),
                ["a-model", "z-model"]
            );
        }
        assert_eq!(calls.lock().len(), 3);
        task.abort();
    }

    #[tokio::test]
    async fn missing_key_and_malformed_lists_do_not_become_empty_success() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = super::super::request_tests::config(
            &format!("http://{}/v1", listener.local_addr().unwrap()),
            1000,
        );
        let app = Router::new().route(
            "/v1/models",
            get(|| async { (StatusCode::OK, Json(json!({"models": []}))) }),
        );
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let provider = OpenAiCompatibleProvider::new(reqwest::Client::new());
        assert!(provider
            .list_models(&config, "")
            .await
            .unwrap_err()
            .contains("API Key"));
        assert!(provider
            .list_models(&config, "test-key")
            .await
            .unwrap_err()
            .contains("data"));
        task.abort();
    }
}
