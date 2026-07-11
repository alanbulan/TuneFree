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

pub async fn enhance_recommendations(
    conn: Arc<Mutex<Connection>>,
    provider: &OpenAiCompatibleProvider,
    query: &RecommendationQuery,
    local_items: Vec<RecommendationItem>,
    request_id: &str,
) -> LlmEnhancementResult {
    let context = match rerank_context(&conn, request_id, local_items.len()) {
        Ok(context) => context,
        Err(error) => return LlmEnhancementResult::failed(local_items, error),
    };
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
    if let Some(result) = cached_enhancement(
        &conn,
        &cache_key,
        &context.config.model,
        &local_items,
        max_results,
        request_id,
        candidates.len(),
    ) {
        return result;
    }
    let started = Instant::now();
    let content =
        match request_json_with_fallback(provider, &context.config, &context.api_key, messages)
            .await
        {
            Ok(content) => content,
            Err(error) => {
                log_rerank_failure(
                    &conn,
                    request_id,
                    &context.config.model,
                    "request_failed",
                    candidates.len(),
                    started.elapsed().as_millis() as i64,
                    &error,
                );
                return LlmEnhancementResult::failed(local_items, error);
            }
        };
    let completion = EnhancementCompletion {
        conn: &conn,
        cache_key: &cache_key,
        config: &context.config,
        request_id,
        candidate_count: candidates.len(),
        latency_ms: started.elapsed().as_millis() as i64,
    };
    finish_enhancement(completion, &content, local_items, max_results)
}

fn rerank_context(
    conn: &Arc<Mutex<Connection>>,
    request_id: &str,
    candidate_count: usize,
) -> Result<LlmRequestContext, String> {
    let guard = conn.lock();
    load_request_context(&guard).inspect_err(|error| {
        log_llm_call(
            &guard,
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
    conn: &Arc<Mutex<Connection>>,
    cache_key: &str,
    model: &str,
    local_items: &[RecommendationItem],
    max_results: usize,
    request_id: &str,
    candidate_count: usize,
) -> Option<LlmEnhancementResult> {
    let content = match load_cache(&conn.lock(), cache_key) {
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
        &conn.lock(),
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
    conn: &'a Arc<Mutex<Connection>>,
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
            let guard = completion.conn.lock();
            if let Err(error) = save_cache(&guard, completion.cache_key, completion.config, content)
            {
                log::warn!("保存模型推荐缓存失败，本次结果仍正常返回: {}", error);
            }
            log_llm_call(
                &guard,
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
            log_rerank_failure(
                completion.conn,
                completion.request_id,
                &completion.config.model,
                "invalid_json",
                completion.candidate_count,
                completion.latency_ms,
                "模型响应 JSON 不符合推荐格式",
            );
            LlmEnhancementResult::failed(local_items, "模型响应 JSON 不符合推荐格式".to_string())
        }
    }
}

fn log_rerank_failure(
    conn: &Arc<Mutex<Connection>>,
    request_id: &str,
    model: &str,
    status: &str,
    candidate_count: usize,
    latency_ms: i64,
    error: &str,
) {
    log_llm_call(
        &conn.lock(),
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
