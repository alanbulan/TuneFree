use std::{sync::Arc, time::Instant};

use parking_lot::Mutex;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::json;

use super::*;
use crate::recommendation::{privacy, prompt, provider::OpenAiCompatibleProvider};

/// 「这一刻想听什么」的语境搜歌：让用户自己配置的模型给出歌名 + 歌手，
/// 真正的歌曲数据（封面、id、可播放地址）由前端拿这些名字去各音乐平台搜。
///
/// 模型只负责「推荐哪几首」，绝不让它编造平台 id —— 编出来的 id 必然解析失败，
/// 这也是过去 AI 搜歌封面出不来的根因（拿到的是模型臆造的 pic_id）。
const CONTEXT_SYSTEM_PROMPT: &str = "你是 TuneFree Desktop 的场景选曲助手。用户会给出一种心情、场景或意境，你要推荐真实存在的歌曲。只推荐你确信真实存在且歌手准确的歌曲，不要编造。输出必须是合法 JSON，不要输出 Markdown，不要解释你的推理过程。";

#[derive(Debug, Deserialize)]
struct ContextResponse {
    #[serde(default)]
    songs: Vec<ContextResponseSong>,
}

#[derive(Debug, Deserialize)]
struct ContextResponseSong {
    name: String,
    artist: String,
    reason: Option<String>,
}

/// 一条语境推荐：歌名 + 歌手 + 简短理由，供前端去平台搜索匹配。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSongSuggestion {
    pub name: String,
    pub artist: String,
    pub reason: String,
}

pub struct ContextSearchResult {
    pub songs: Vec<ContextSongSuggestion>,
    pub error: Option<String>,
}

pub async fn build_context_songs(
    conn: Arc<Mutex<Connection>>,
    provider: &OpenAiCompatibleProvider,
    keyword: &str,
    limit: usize,
    request_id: &str,
) -> ContextSearchResult {
    let keyword = keyword.trim().to_string();
    if keyword.is_empty() {
        return ContextSearchResult {
            songs: Vec::new(),
            error: Some("请先描述想听的场景或心情".to_string()),
        };
    }
    let worker_id = request_id.to_string();
    let context = match run_llm_blocking(Arc::clone(&conn), move |connection| {
        // 记日志但保留原错误：调用方要据此区分「没配模型」和「服务不可用」。
        load_request_context(connection).inspect_err(|error| {
            log_llm_call(
                connection,
                LlmCallLog {
                    request_id: &worker_id,
                    model: "",
                    status: "context_search_config_error",
                    latency_ms: None,
                    candidate_count: 0,
                    result_count: 0,
                    error_code: Some(error),
                },
            );
        })
    })
    .await
    {
        Ok(Ok(context)) => context,
        Ok(Err(error)) | Err(error) => {
            return ContextSearchResult {
                songs: Vec::new(),
                error: Some(error),
            }
        }
    };

    let messages = build_context_messages(&keyword, limit, &context.profile_tokens);
    let started = Instant::now();
    let response =
        request_json_with_fallback(provider, &context.config, &context.api_key, messages).await;
    let request_id = request_id.to_string();
    run_llm_blocking(conn, move |connection| {
        complete_context_search(
            connection,
            &request_id,
            &context.config.model,
            started,
            response,
            limit,
        )
    })
    .await
    .unwrap_or_else(|error| ContextSearchResult {
        songs: Vec::new(),
        error: Some(error),
    })
}

fn build_context_messages(
    keyword: &str,
    limit: usize,
    profile_tokens: &[super::ProfileToken],
) -> Vec<serde_json::Value> {
    let user_payload = json!({
        "scene": "context_search",
        "limit": limit,
        "user_input": keyword,
        "profile_tokens": privacy::redact_profile(profile_tokens),
        "rules": [
            "推荐真实存在的歌曲，歌手名必须准确，绝不编造歌曲",
            "不要输出任何平台 id、链接或封面地址，只给歌名和歌手",
            "歌名使用歌曲的正式名称，不要加入「(伴奏)」「(纯音乐版)」等无关后缀",
            "在贴合场景的前提下兼顾风格多样性，不要全是同一个歌手",
            "可以包含华语、欧美、日韩等不同语种，除非用户明确限定",
            "reason 必须是 20 个中文字符以内的短句，说明它为什么贴合这个场景",
            "songs 数量不能超过 limit，不要重复同一首歌",
            "输出 JSON: {\"songs\": [{\"name\": \"歌名\", \"artist\": \"歌手\", \"reason\": \"简短理由\"}]}"
        ]
    });
    vec![
        json!({ "role": "system", "content": CONTEXT_SYSTEM_PROMPT }),
        json!({ "role": "user", "content": user_payload.to_string() }),
    ]
}

fn complete_context_search(
    conn: &Connection,
    request_id: &str,
    model: &str,
    started: Instant,
    response: Result<String, String>,
    limit: usize,
) -> ContextSearchResult {
    let content = match response {
        Ok(content) => content,
        Err(error) => {
            log_llm_call(
                conn,
                LlmCallLog {
                    request_id,
                    model,
                    status: "context_search_request_failed",
                    latency_ms: Some(started.elapsed().as_millis() as i64),
                    candidate_count: 0,
                    result_count: 0,
                    error_code: Some(&error),
                },
            );
            return ContextSearchResult {
                songs: Vec::new(),
                error: Some(error),
            };
        }
    };
    let Some(songs) = parse_context_response(&content, limit).filter(|items| !items.is_empty())
    else {
        let sample = response_sample(&content);
        log::warn!("语境搜歌无法解析出有效歌曲，响应样本: {}", sample);
        log_llm_call(
            conn,
            LlmCallLog {
                request_id,
                model,
                status: "context_search_invalid_json",
                latency_ms: Some(started.elapsed().as_millis() as i64),
                candidate_count: 0,
                result_count: 0,
                error_code: Some(&sample),
            },
        );
        return ContextSearchResult {
            songs: Vec::new(),
            error: Some("模型没有返回可用的歌曲列表".to_string()),
        };
    };
    log_llm_call(
        conn,
        LlmCallLog {
            request_id,
            model,
            status: "context_search_ok",
            latency_ms: Some(started.elapsed().as_millis() as i64),
            candidate_count: 0,
            result_count: songs.len(),
            error_code: None,
        },
    );
    ContextSearchResult { songs, error: None }
}

fn parse_context_response(content: &str, limit: usize) -> Option<Vec<ContextSongSuggestion>> {
    let parsed: ContextResponse = extract_json(content)?;
    let mut songs = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in parsed.songs {
        let name = item.name.trim();
        let artist = item.artist.trim();
        if name.is_empty() || artist.is_empty() {
            continue;
        }
        let key = format!(
            "{}|{}",
            catalog::normalize_text(name),
            catalog::normalize_text(artist)
        );
        if !seen.insert(key) {
            continue;
        }
        songs.push(ContextSongSuggestion {
            name: privacy::short_reason(name),
            artist: privacy::short_reason(artist),
            reason: item
                .reason
                .as_deref()
                .and_then(|reason| prompt::item_reason(Some(reason)))
                .unwrap_or_else(|| "贴合当前场景".to_string()),
        });
        if songs.len() >= limit {
            break;
        }
    }
    Some(songs)
}

#[cfg(test)]
mod tests {
    use super::parse_context_response;

    #[test]
    fn parses_fenced_song_list_and_deduplicates() {
        let content = "```json\n{\"songs\":[\
            {\"name\":\"雨天\",\"artist\":\"孙燕姿\",\"reason\":\"雨声与慵懒女声\"},\
            {\"name\":\"雨天\",\"artist\":\"孙燕姿\"},\
            {\"name\":\"下雨天\",\"artist\":\"南拳妈妈\"}]}\n```";

        let songs = parse_context_response(content, 5).unwrap();

        assert_eq!(songs.len(), 2);
        assert_eq!(songs[0].name, "雨天");
        assert_eq!(songs[0].artist, "孙燕姿");
        assert_eq!(songs[1].name, "下雨天");
    }

    #[test]
    fn drops_entries_missing_name_or_artist_and_honours_limit() {
        let content = "{\"songs\":[{\"name\":\"\",\"artist\":\"歌手\"},\
            {\"name\":\"歌曲\",\"artist\":\"  \"},\
            {\"name\":\"A\",\"artist\":\"甲\"},{\"name\":\"B\",\"artist\":\"乙\"}]}";

        let songs = parse_context_response(content, 1).unwrap();

        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].name, "A");
    }

    #[test]
    fn rejects_truncated_or_refusal_responses() {
        assert!(parse_context_response("{\"songs\":[{\"name\":\"雨天\"", 5).is_none());
        assert!(parse_context_response("抱歉，我无法完成该请求。", 5).is_none());
    }
}
