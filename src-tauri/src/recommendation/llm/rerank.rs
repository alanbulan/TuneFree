use std::{sync::Arc, time::Instant};

use parking_lot::Mutex;
use rusqlite::Connection;

use super::*;
use super::{
    cache::{cache_key, load_cache, save_cache},
    response::apply_llm_response,
};
use crate::recommendation::{
    model::{RecommendationItem, RecommendationQuery},
    prompt,
    provider::OpenAiCompatibleProvider,
};

struct PreparedEnhancement {
    context: LlmRequestContext,
    messages: Vec<Value>,
    cache_key: String,
    max_results: usize,
    candidate_count: usize,
    cached: Option<LlmEnhancementResult>,
}

pub async fn enhance_recommendations(
    conn: Arc<Mutex<Connection>>,
    provider: &OpenAiCompatibleProvider,
    query: &RecommendationQuery,
    local_items: Vec<RecommendationItem>,
    request_id: &str,
) -> LlmEnhancementResult {
    let worker_query = query.clone();
    let worker_items = local_items.clone();
    let worker_id = request_id.to_string();
    let prepared = run_llm_blocking(Arc::clone(&conn), move |connection| {
        prepare_enhancement(connection, &worker_query, &worker_items, &worker_id)
    })
    .await
    .and_then(|result| result);
    let prepared = match prepared {
        Ok(prepared) => prepared,
        Err(error) => return LlmEnhancementResult::failed(local_items, error),
    };
    if let Some(cached) = prepared.cached {
        return cached;
    }
    let started = Instant::now();
    let response = request_json_with_fallback(
        provider,
        &prepared.context.config,
        &prepared.context.api_key,
        prepared.messages,
    )
    .await;
    let request_id = request_id.to_string();
    let fallback = local_items.clone();
    run_llm_blocking(conn, move |connection| {
        let config = prepared.context.config;
        match response {
            Ok(content) => finish_enhancement(
                EnhancementCompletion {
                    conn: connection,
                    cache_key: &prepared.cache_key,
                    config: &config,
                    request_id: &request_id,
                    candidate_count: prepared.candidate_count,
                    latency_ms: started.elapsed().as_millis() as i64,
                },
                &content,
                local_items,
                prepared.max_results,
            ),
            Err(error) => {
                log_rerank_failure(
                    connection,
                    &request_id,
                    &config.model,
                    "request_failed",
                    prepared.candidate_count,
                    started.elapsed().as_millis() as i64,
                    &error,
                );
                LlmEnhancementResult::failed(local_items, error)
            }
        }
    })
    .await
    .unwrap_or_else(|error| LlmEnhancementResult::failed(fallback, error))
}

fn prepare_enhancement(
    conn: &Connection,
    query: &RecommendationQuery,
    local_items: &[RecommendationItem],
    request_id: &str,
) -> Result<PreparedEnhancement, String> {
    let context = rerank_context(conn, request_id, local_items.len())?;
    let max_candidates = context.config.max_candidates.min(local_items.len()).max(1);
    let max_results = context
        .config
        .max_results
        .min(query.limit.unwrap_or(30))
        .min(local_items.len())
        .max(1);
    let candidates = local_items
        .iter()
        .take(max_candidates)
        .cloned()
        .collect::<Vec<_>>();
    let messages = prompt::build_messages(
        query,
        &context.profile_tokens,
        &candidates,
        max_results,
        context
            .config
            .upload_recent_events
            .then_some(context.recent_events.as_slice()),
    );
    let cache_key = cache_key(&context.config, &messages, max_results);
    let cached = cached_enhancement(
        conn,
        &cache_key,
        &context.config.model,
        local_items,
        max_results,
        request_id,
        candidates.len(),
    );
    Ok(PreparedEnhancement {
        context,
        messages,
        cache_key,
        max_results,
        candidate_count: candidates.len(),
        cached,
    })
}

fn rerank_context(
    conn: &Connection,
    request_id: &str,
    candidate_count: usize,
) -> Result<LlmRequestContext, String> {
    load_request_context(conn).inspect_err(|error| {
        log_llm_call(
            conn,
            LlmCallLog {
                request_id,
                model: "",
                status: "context_error",
                latency_ms: None,
                candidate_count,
                result_count: 0,
                error_code: Some(error),
            },
        );
    })
}

fn cached_enhancement(
    conn: &Connection,
    cache_key: &str,
    model: &str,
    local_items: &[RecommendationItem],
    max_results: usize,
    request_id: &str,
    candidate_count: usize,
) -> Option<LlmEnhancementResult> {
    let content = match load_cache(conn, cache_key) {
        Ok(content) => content?,
        Err(error) => {
            log::warn!("读取模型推荐缓存失败，继续请求模型: {}", error);
            return None;
        }
    };
    let Some(items) = apply_llm_response(&content, local_items.to_vec(), max_results, request_id)
    else {
        log::warn!("模型推荐缓存内容无效，继续请求模型刷新缓存");
        return None;
    };
    log_llm_call(
        conn,
        LlmCallLog {
            request_id,
            model,
            status: "cache_hit",
            latency_ms: Some(0),
            candidate_count,
            result_count: items.len(),
            error_code: None,
        },
    );
    Some(LlmEnhancementResult::ok(items))
}

struct EnhancementCompletion<'a> {
    conn: &'a Connection,
    cache_key: &'a str,
    config: &'a crate::recommendation::model::LlmConfig,
    request_id: &'a str,
    candidate_count: usize,
    latency_ms: i64,
}

fn finish_enhancement(
    completion: EnhancementCompletion<'_>,
    content: &str,
    local_items: Vec<RecommendationItem>,
    max_results: usize,
) -> LlmEnhancementResult {
    match apply_llm_response(
        content,
        local_items.clone(),
        max_results,
        completion.request_id,
    ) {
        Some(items) => {
            let guard = completion.conn;
            if let Err(error) = save_cache(guard, completion.cache_key, completion.config, content)
            {
                log::warn!("保存模型推荐缓存失败，本次结果仍正常返回: {}", error);
            }
            log_llm_call(
                guard,
                LlmCallLog {
                    request_id: completion.request_id,
                    model: &completion.config.model,
                    status: "ok",
                    latency_ms: Some(completion.latency_ms),
                    candidate_count: completion.candidate_count,
                    result_count: items.len(),
                    error_code: None,
                },
            );
            LlmEnhancementResult::ok(items)
        }
        None => {
            let sample = response_sample(content);
            log::warn!("模型重排响应无法解析为推荐 JSON，响应样本: {}", sample);
            log_rerank_failure(
                completion.conn,
                completion.request_id,
                &completion.config.model,
                "invalid_json",
                completion.candidate_count,
                completion.latency_ms,
                &sample,
            );
            LlmEnhancementResult::failed(local_items, "模型响应 JSON 不符合推荐格式".to_string())
        }
    }
}

fn log_rerank_failure(
    conn: &Connection,
    request_id: &str,
    model: &str,
    status: &str,
    candidate_count: usize,
    latency_ms: i64,
    error: &str,
) {
    log_llm_call(
        conn,
        LlmCallLog {
            request_id,
            model,
            status,
            latency_ms: Some(latency_ms),
            candidate_count,
            result_count: 0,
            error_code: Some(error),
        },
    );
}
