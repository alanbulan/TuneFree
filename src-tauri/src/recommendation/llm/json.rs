use serde::de::DeserializeOwned;

/// Maximum characters of a malformed response kept for diagnostics.
const RESPONSE_SAMPLE_CHARS: usize = 200;

/// Parses model output that should be a JSON object, tolerating the markdown
/// code fences and surrounding prose that many OpenAI-compatible endpoints
/// emit even when `response_format` requests a plain JSON object.
///
/// Strategy: direct parse first, then the body of the first ``` fenced
/// block, then the substring from the first `{` to the last `}`.
pub fn extract_json<T: DeserializeOwned>(content: &str) -> Option<T> {
    let trimmed = content.trim();
    if let Ok(parsed) = serde_json::from_str(trimmed) {
        return Some(parsed);
    }
    if let Some(fenced) = fenced_block(trimmed) {
        if let Ok(parsed) = serde_json::from_str(fenced.trim()) {
            return Some(parsed);
        }
    }
    serde_json::from_str(braced_slice(trimmed)?).ok()
}

/// First 200 characters of a malformed response, for diagnostics logging.
pub fn response_sample(content: &str) -> String {
    content.trim().chars().take(RESPONSE_SAMPLE_CHARS).collect()
}

/// Returns the body of the first ``` fenced block, skipping an optional
/// language tag such as `json` on the opening fence line.
fn fenced_block(content: &str) -> Option<&str> {
    let start = content.find("```")?;
    let after = &content[start + 3..];
    let body_start = after.find('\n').map(|index| index + 1).unwrap_or(0);
    let body = &after[body_start..];
    let end = body.rfind("```").unwrap_or(body.len());
    Some(&body[..end])
}

/// Substring from the first `{` to the last `}`, if both exist in order.
fn braced_slice(content: &str) -> Option<&str> {
    let start = content.find('{')?;
    let end = content.rfind('}')?;
    (end > start).then(|| &content[start..=end])
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use serde_json::Value;

    use super::*;

    #[derive(Debug, Deserialize)]
    struct Sample {
        items: Vec<String>,
    }

    #[test]
    fn parses_plain_json_object() {
        let parsed: Sample = extract_json(r#"{"items":["a","b"]}"#).unwrap();
        assert_eq!(parsed.items, vec!["a", "b"]);
    }

    #[test]
    fn parses_json_wrapped_in_language_tagged_fence() {
        let content = "```json\n{\"items\":[\"a\"]}\n```";
        let parsed: Sample = extract_json(content).unwrap();
        assert_eq!(parsed.items, vec!["a"]);
    }

    #[test]
    fn parses_json_wrapped_in_bare_fence_without_newline() {
        let content = "```{\"items\":[\"a\"]}```";
        let parsed: Sample = extract_json(content).unwrap();
        assert_eq!(parsed.items, vec!["a"]);
    }

    #[test]
    fn parses_json_surrounded_by_prose() {
        let content = "好的，以下是推荐结果：\n{\"items\":[\"a\"]}\n希望对你有帮助。";
        let parsed: Sample = extract_json(content).unwrap();
        assert_eq!(parsed.items, vec!["a"]);
    }

    #[test]
    fn parses_fenced_json_with_prose_around_the_fence() {
        let content = "结果如下：\n```json\n{\"items\":[\"a\",\"b\"]}\n```\n完毕。";
        let parsed: Sample = extract_json(content).unwrap();
        assert_eq!(parsed.items, vec!["a", "b"]);
    }

    #[derive(Debug, Deserialize)]
    struct Nested {
        plan: Plan,
    }

    #[derive(Debug, Deserialize)]
    struct Plan {
        queries: Vec<Query>,
    }

    #[derive(Debug, Deserialize)]
    struct Query {
        keyword: String,
    }

    const NESTED_JSON: &str = r#"{"plan":{"queries":[{"keyword":"周杰伦"},{"keyword":"林俊杰"}]}}"#;

    #[test]
    fn parses_nested_objects_in_every_wrapper_form() {
        let plain: Nested = extract_json(NESTED_JSON).unwrap();
        assert_eq!(plain.plan.queries[0].keyword, "周杰伦");

        let fenced: Nested = extract_json(&format!("```json\n{NESTED_JSON}\n```")).unwrap();
        assert_eq!(fenced.plan.queries.len(), 2);

        let prose: Nested = extract_json(&format!("这是计划：\n{NESTED_JSON}\n请查收")).unwrap();
        assert_eq!(prose.plan.queries[1].keyword, "林俊杰");

        let fenced_with_prose: Nested =
            extract_json(&format!("说明\n```\n{NESTED_JSON}\n```\n结束")).unwrap();
        assert_eq!(fenced_with_prose.plan.queries.len(), 2);
    }

    #[test]
    fn ignores_the_fence_language_tag_whatever_its_case() {
        for tag in ["json", "JSON", "Json", "jsonc"] {
            let content = format!("```{tag}\n{{\"items\":[\"a\"]}}\n```");
            let parsed: Sample = extract_json(&content).unwrap();
            assert_eq!(parsed.items, vec!["a"], "语言标记 {tag} 应被忽略");
        }
    }

    #[test]
    fn parses_pretty_printed_json_with_blank_lines() {
        let content = "```json\n{\n  \"items\": [\n    \"a\",\n    \"b\"\n  ]\n}\n```";
        let parsed: Sample = extract_json(content).unwrap();
        assert_eq!(parsed.items, vec!["a", "b"]);
    }

    #[test]
    fn rejects_json_whose_shape_does_not_match() {
        // 结构不匹配必须失败，不能"提取到什么算什么"。
        assert!(extract_json::<Sample>(r#"{"items":"not-an-array"}"#).is_none());
        assert!(extract_json::<Sample>(r#"{"other":[1]}"#).is_none());
        assert!(extract_json::<Nested>(NESTED_JSON.replace("plan", "planning").as_str()).is_none());
    }

    #[test]
    fn rejects_truncated_json() {
        let content = "```json\n{\"items\":[\"a\",\"b\"\n```";
        assert!(extract_json::<Sample>(content).is_none());
        assert!(extract_json::<Sample>(r#"{"items":["a""#).is_none());
    }

    #[test]
    fn rejects_content_without_json_object() {
        assert!(extract_json::<Value>("抱歉，我无法完成这个请求。").is_none());
        assert!(extract_json::<Value>("").is_none());
    }

    #[test]
    fn response_sample_is_bounded_and_trimmed() {
        let long = format!("  {}  ", "样".repeat(500));
        let sample = response_sample(&long);
        assert_eq!(sample.chars().count(), 200);
        assert!(sample.starts_with('样'));
    }
}
