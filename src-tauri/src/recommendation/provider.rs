use std::time::Instant;

use reqwest::Client;
use serde_json::json;

use super::{
    llm::extract_json,
    model::{LlmConfig, LlmProviderTestResult},
    privacy,
};

const CHAT_COMPLETION_MAX_TOKENS: u64 = 2_000;

enum ChatRequestOutcome {
    Success(String),
    Unauthorized(String),
    UnsupportedSystemRole(String),
    Failed(String),
}

#[derive(Clone)]
pub struct OpenAiCompatibleProvider {
    client: Client,
}

impl OpenAiCompatibleProvider {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    fn chat_completion_urls(base_url: &str) -> Vec<String> {
        let Ok(base) = privacy::validate_base_url(base_url) else {
            return Vec::new();
        };
        let lower = base.to_ascii_lowercase();
        if lower.ends_with("/chat/completions") {
            return vec![base];
        }

        if lower.ends_with("/v1") {
            return vec![format!("{}/chat/completions", base)];
        }

        vec![
            format!("{}/v1/chat/completions", base),
            format!("{}/chat/completions", base),
        ]
    }

    fn chat_request_body(
        model: &str,
        messages: &[serde_json::Value],
        use_json_object: bool,
    ) -> serde_json::Value {
        let mut body = json!({
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": CHAT_COMPLETION_MAX_TOKENS,
        });
        if use_json_object {
            body["response_format"] = json!({ "type": "json_object" });
        }
        body
    }

    fn messages_without_system_role(
        messages: &[serde_json::Value],
    ) -> Option<Vec<serde_json::Value>> {
        let system_prompt = messages
            .iter()
            .filter(|message| message.get("role").and_then(|role| role.as_str()) == Some("system"))
            .filter_map(|message| message.get("content").and_then(|content| content.as_str()))
            .collect::<Vec<_>>()
            .join("\n\n");
        if system_prompt.is_empty() {
            return None;
        }

        let mut compatible_messages = messages
            .iter()
            .filter(|message| message.get("role").and_then(|role| role.as_str()) != Some("system"))
            .cloned()
            .collect::<Vec<_>>();
        if let Some(user_message) = compatible_messages.iter_mut().find(|message| {
            message.get("role").and_then(|role| role.as_str()) == Some("user")
                && message
                    .get("content")
                    .and_then(|content| content.as_str())
                    .is_some()
        }) {
            let user_content = user_message["content"].as_str().unwrap_or_default();
            user_message["content"] = json!(format!("{}\n\n{}", system_prompt, user_content));
        } else {
            compatible_messages.insert(0, json!({ "role": "user", "content": system_prompt }));
        }
        Some(compatible_messages)
    }

    fn system_role_is_unsupported(status: u16, message: &str) -> bool {
        let lower = message.to_ascii_lowercase();
        matches!(status, 400 | 422)
            && lower.contains("system")
            && lower.contains("role")
            && (lower.contains("not supported") || lower.contains("unsupported"))
    }

    async fn request_chat_completion(
        &self,
        url: &str,
        config: &LlmConfig,
        api_key: &str,
        body: &serde_json::Value,
    ) -> ChatRequestOutcome {
        let response = match self
            .client
            .post(url)
            .bearer_auth(api_key)
            .timeout(std::time::Duration::from_millis(config.timeout_ms))
            .json(body)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                return ChatRequestOutcome::Failed(format!("模型服务请求失败: {}", error));
            }
        };
        let status = response.status();
        let value: serde_json::Value = match response.json().await {
            Ok(value) => value,
            Err(error) => {
                return ChatRequestOutcome::Failed(format!("模型服务响应不是 JSON: {}", error));
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
                return ChatRequestOutcome::Unauthorized(error);
            }
            if Self::system_role_is_unsupported(status.as_u16(), message) {
                return ChatRequestOutcome::UnsupportedSystemRole(error);
            }
            return ChatRequestOutcome::Failed(error);
        }

        match value
            .get("choices")
            .and_then(|choices| choices.get(0))
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(|content| content.as_str())
        {
            Some(content) => ChatRequestOutcome::Success(content.to_string()),
            None => ChatRequestOutcome::Failed(
                "模型服务响应缺少 choices[0].message.content".to_string(),
            ),
        }
    }

    pub async fn chat_json(
        &self,
        config: &LlmConfig,
        api_key: &str,
        messages: Vec<serde_json::Value>,
        use_json_object: bool,
    ) -> Result<String, String> {
        let compatible_messages = Self::messages_without_system_role(&messages);

        let mut last_error = None;
        for url in Self::chat_completion_urls(&config.base_url) {
            let body = Self::chat_request_body(&config.model, &messages, use_json_object);
            match self
                .request_chat_completion(&url, config, api_key, &body)
                .await
            {
                ChatRequestOutcome::Success(content) => return Ok(content),
                ChatRequestOutcome::Unauthorized(error) => return Err(error),
                ChatRequestOutcome::UnsupportedSystemRole(error) => {
                    let Some(compatible_messages) = compatible_messages.as_ref() else {
                        last_error = Some(error);
                        continue;
                    };
                    let compatible_body = Self::chat_request_body(
                        &config.model,
                        compatible_messages,
                        use_json_object,
                    );
                    match self
                        .request_chat_completion(&url, config, api_key, &compatible_body)
                        .await
                    {
                        ChatRequestOutcome::Success(content) => return Ok(content),
                        ChatRequestOutcome::Unauthorized(error) => return Err(error),
                        ChatRequestOutcome::UnsupportedSystemRole(error)
                        | ChatRequestOutcome::Failed(error) => last_error = Some(error),
                    }
                }
                ChatRequestOutcome::Failed(error) => last_error = Some(error),
            }
        }

        Err(last_error.unwrap_or_else(|| "请填写 API 根地址".to_string()))
    }

    pub async fn test(&self, config: &LlmConfig, api_key: &str) -> LlmProviderTestResult {
        if config.base_url.trim().is_empty()
            || config.model.trim().is_empty()
            || api_key.trim().is_empty()
        {
            return LlmProviderTestResult {
                ok: false,
                status: "missing_config".to_string(),
                latency_ms: None,
                supports_json_object: false,
                error: Some(
                    "请填写 API 根地址、模型名和 API Key；如果已经保存 Key，请重新填写保存一次"
                        .to_string(),
                ),
            };
        }

        let started = Instant::now();
        let messages = vec![
            json!({ "role": "system", "content": "只输出合法 JSON。" }),
            json!({ "role": "user", "content": "输出 {\"ok\": true}" }),
        ];

        match self
            .chat_json(config, api_key, messages.clone(), true)
            .await
        {
            Ok(content) => {
                let ok = extract_json::<serde_json::Value>(&content)
                    .map(|value| value.get("ok").and_then(|ok| ok.as_bool()).unwrap_or(false))
                    .unwrap_or(false);
                LlmProviderTestResult {
                    ok,
                    status: if ok { "ok" } else { "invalid_json" }.to_string(),
                    latency_ms: Some(started.elapsed().as_millis() as u64),
                    supports_json_object: true,
                    error: if ok {
                        None
                    } else {
                        Some("模型响应 JSON 不符合预期".to_string())
                    },
                }
            }
            Err(first_error) => {
                let started = Instant::now();
                match self.chat_json(config, api_key, messages, false).await {
                    Ok(content) => {
                        let ok = extract_json::<serde_json::Value>(&content).is_some();
                        LlmProviderTestResult {
                            ok,
                            status: if ok {
                                "ok_without_json_object"
                            } else {
                                "invalid_json"
                            }
                            .to_string(),
                            latency_ms: Some(started.elapsed().as_millis() as u64),
                            supports_json_object: false,
                            error: if ok {
                                None
                            } else {
                                Some("模型响应不是合法 JSON".to_string())
                            },
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::OpenAiCompatibleProvider;

    #[test]
    fn only_builds_secure_or_loopback_completion_urls() {
        assert!(OpenAiCompatibleProvider::chat_completion_urls("http://example.com/v1").is_empty());
        assert_eq!(
            OpenAiCompatibleProvider::chat_completion_urls("https://example.com/v1"),
            vec!["https://example.com/v1/chat/completions"]
        );
        assert_eq!(
            OpenAiCompatibleProvider::chat_completion_urls("http://127.0.0.1:11434/v1"),
            vec!["http://127.0.0.1:11434/v1/chat/completions"]
        );
        assert_eq!(
            OpenAiCompatibleProvider::chat_completion_urls("https://example.com"),
            vec![
                "https://example.com/v1/chat/completions",
                "https://example.com/chat/completions"
            ]
        );
    }

    #[test]
    fn chat_request_body_includes_positive_max_tokens() {
        let body = OpenAiCompatibleProvider::chat_request_body(
            "grok-4.5",
            &[json!({ "role": "user", "content": "test" })],
            true,
        );

        assert_eq!(body["max_tokens"].as_u64(), Some(2_000));
        assert_eq!(body["response_format"]["type"], "json_object");
    }

    #[test]
    fn merges_system_prompt_into_user_message_for_compatible_retry() {
        let messages = vec![
            json!({ "role": "system", "content": "只输出合法 JSON。" }),
            json!({ "role": "user", "content": "输出 {\"ok\": true}" }),
        ];

        let compatible = OpenAiCompatibleProvider::messages_without_system_role(&messages).unwrap();

        assert_eq!(compatible.len(), 1);
        assert_eq!(compatible[0]["role"], "user");
        assert_eq!(
            compatible[0]["content"],
            "只输出合法 JSON。\n\n输出 {\"ok\": true}"
        );
    }

    #[test]
    fn only_retries_explicit_unsupported_system_role_errors() {
        assert!(OpenAiCompatibleProvider::system_role_is_unsupported(
            400,
            "messages[0].role \"system\" is not supported"
        ));
        assert!(!OpenAiCompatibleProvider::system_role_is_unsupported(
            400,
            "max_tokens is required"
        ));
        assert!(!OpenAiCompatibleProvider::system_role_is_unsupported(
            401,
            "system role is not supported"
        ));
    }
}
