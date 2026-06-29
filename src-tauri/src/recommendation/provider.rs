use std::time::Instant;

use reqwest::Client;
use serde_json::json;

use super::{
    model::{LlmConfig, LlmProviderTestResult},
    privacy,
};

#[derive(Clone)]
pub struct OpenAiCompatibleProvider {
    client: Client,
}

impl OpenAiCompatibleProvider {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    fn chat_completion_urls(base_url: &str) -> Vec<String> {
        let base = privacy::sanitize_base_url(base_url);
        if base.is_empty() {
            return Vec::new();
        }
        let lower = base.to_ascii_lowercase();
        if lower.ends_with("/chat/completions") {
            return vec![base];
        }

        let mut urls = vec![format!("{}/chat/completions", base)];
        if !lower.ends_with("/v1") {
            urls.push(format!("{}/v1/chat/completions", base));
        }
        urls
    }

    pub async fn chat_json(
        &self,
        config: &LlmConfig,
        api_key: &str,
        messages: Vec<serde_json::Value>,
        use_json_object: bool,
    ) -> Result<String, String> {
        let mut body = json!({
            "model": config.model,
            "messages": messages,
            "temperature": 0.2,
        });
        if use_json_object {
            body["response_format"] = json!({ "type": "json_object" });
        }

        let mut last_error = None;
        for url in Self::chat_completion_urls(&config.base_url) {
            let response = match self
                .client
                .post(url)
                .bearer_auth(api_key)
                .timeout(std::time::Duration::from_millis(config.timeout_ms))
                .json(&body)
                .send()
                .await
            {
                Ok(response) => response,
                Err(e) => {
                    last_error = Some(format!("模型服务请求失败: {}", e));
                    continue;
                }
            };

            let status = response.status();
            let value: serde_json::Value = match response.json().await {
                Ok(value) => value,
                Err(e) => {
                    last_error = Some(format!("模型服务响应不是 JSON: {}", e));
                    continue;
                }
            };

            if !status.is_success() {
                let message = value
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(|message| message.as_str())
                    .unwrap_or("模型服务返回错误");
                let error = format!("{}: {}", status.as_u16(), message);
                if status.as_u16() == 401 || status.as_u16() == 403 {
                    return Err(error);
                }
                last_error = Some(error);
                continue;
            }

            match value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("message"))
                .and_then(|message| message.get("content"))
                .and_then(|content| content.as_str())
            {
                Some(content) => return Ok(content.to_string()),
                None => {
                    last_error = Some("模型服务响应缺少 choices[0].message.content".to_string());
                }
            }
        }

        Err(last_error.unwrap_or_else(|| "请填写 API 根地址".to_string()))
    }

    pub async fn test(&self, config: &LlmConfig, api_key: &str) -> LlmProviderTestResult {
        if config.base_url.trim().is_empty() || config.model.trim().is_empty() || api_key.trim().is_empty() {
            return LlmProviderTestResult {
                ok: false,
                status: "missing_config".to_string(),
                latency_ms: None,
                supports_json_object: false,
                error: Some("请填写 API 根地址、模型名和 API Key；如果已经保存 Key，请重新填写保存一次".to_string()),
            };
        }

        let started = Instant::now();
        let messages = vec![
            json!({ "role": "system", "content": "只输出合法 JSON。" }),
            json!({ "role": "user", "content": "输出 {\"ok\": true}" }),
        ];

        match self.chat_json(config, api_key, messages.clone(), true).await {
            Ok(content) => {
                let ok = serde_json::from_str::<serde_json::Value>(&content)
                    .map(|value| value.get("ok").and_then(|ok| ok.as_bool()).unwrap_or(false))
                    .unwrap_or(false);
                LlmProviderTestResult {
                    ok,
                    status: if ok { "ok" } else { "invalid_json" }.to_string(),
                    latency_ms: Some(started.elapsed().as_millis() as u64),
                    supports_json_object: true,
                    error: if ok { None } else { Some("模型响应 JSON 不符合预期".to_string()) },
                }
            }
            Err(first_error) => {
                let started = Instant::now();
                match self.chat_json(config, api_key, messages, false).await {
                    Ok(content) => {
                        let ok = serde_json::from_str::<serde_json::Value>(&content).is_ok();
                        LlmProviderTestResult {
                            ok,
                            status: if ok { "ok_without_json_object" } else { "invalid_json" }.to_string(),
                            latency_ms: Some(started.elapsed().as_millis() as u64),
                            supports_json_object: false,
                            error: if ok { None } else { Some("模型响应不是合法 JSON".to_string()) },
                        }
                    }
                    Err(second_error) => LlmProviderTestResult {
                        ok: false,
                        status: "request_failed".to_string(),
                        latency_ms: Some(started.elapsed().as_millis() as u64),
                        supports_json_object: false,
                        error: Some(format!("{}；兼容重试失败: {}", first_error, second_error)),
                    },
                }
            }
        }
    }
}
