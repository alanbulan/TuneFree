use super::*;

pub(super) mod cloud;
mod freshness;
mod scheduling;
mod state;
mod updates;

#[cfg(all(test, windows))]
#[path = "__tests__/job_lifecycle.rs"]
mod lifecycle_tests;

#[cfg(all(test, windows))]
#[path = "__tests__/dynamic_refresh.rs"]
mod dynamic_refresh_tests;

use cloud::{cloud_job_timeout_ms, run_cloud_job, CloudJobTask};
use freshness::{cloud_refresh_decision, load_refresh_state, CloudRefreshContext};
pub(super) use state::idle_job as cleared_job;
#[cfg(all(test, windows))]
use state::initial_job_detail;
#[cfg(test)]
pub(super) use state::is_current_generation;
use state::{build_initial_job, disabled_job};
pub(super) use state::{invalidate_recommendation_state, new_request_id};
pub(super) use updates::emit_job_payload as emit_cancelled_job;
pub(super) use updates::emit_job_update as emit_state_job;
use updates::{
    emit_job_payload, job_update_payload, mark_job_stage, update_recommendation_job, JobTransition,
};

struct PreparedJob {
    generation: u64,
    job: RecommendationJob,
    task: Option<CloudJobTask>,
}

struct CloudJobConfig {
    candidate_window: usize,
    per_request_timeout_ms: u64,
    cache_ttl_ms: i64,
    configured_at: i64,
}

impl RecommendationService {
    pub fn start_recommendation_job(
        &self,
        query: RecommendationQuery,
    ) -> CommandResult<RecommendationJob> {
        self.db_handle()?;
        self.prune_recommendation_jobs();
        if !self.is_recommendation_enabled() {
            return Ok(disabled_job());
        }
        if let Some(job) = self.running_recommendation_job() {
            return Ok(job);
        }
        let prepared = self.prepare_recommendation_job(query)?;
        self.publish_recommendation_job(prepared)
    }

    fn prepare_recommendation_job(&self, query: RecommendationQuery) -> CommandResult<PreparedJob> {
        let generation = {
            let _publication_guard = self.cloud_cancel.lock();
            self.recommendation_generation.load(Ordering::SeqCst)
        };
        let conn = self.conn_handle()?;
        let context = recommendation_context(&query);
        let persisted = self.latest_cloud_recommendation_job(&context);
        let (local, request_id) = self
            .local_items_with_request(&query)
            .map_err(CommandError::database)?;
        let cloud_enabled = self.has_cloud_recommendation_config();
        let config = self.cloud_job_config();
        let now = catalog::now_ms();
        let refresh_state = load_refresh_state(
            &conn.lock(),
            self.last_cloud_refresh_at.load(Ordering::SeqCst),
        )
        .map_err(|error| CommandError::database(format!("读取推荐刷新状态失败: {error}")))?;
        let decision = cloud_refresh_decision(CloudRefreshContext {
            now,
            saved: persisted.as_ref(),
            config: &config,
            enabled: cloud_enabled,
            synced: self.initial_library_synced.load(Ordering::SeqCst),
            requested: self.cloud_refresh_requested.load(Ordering::SeqCst),
            state: &refresh_state,
        });
        let visible = if cloud_enabled {
            persisted
                .as_ref()
                .map(|job| job.items.clone())
                .unwrap_or_default()
        } else {
            local.clone()
        };
        let mut job = build_initial_job(decision.start, &local, visible.clone());
        job.cloud_enabled = cloud_enabled;
        job.result_updated_at = if cloud_enabled {
            persisted.as_ref().map_or(0, |job| job.result_updated_at)
        } else {
            job.local_updated_at
        };
        decision.apply_state(&mut job, cloud_enabled);
        let total_timeout_ms = cloud_job_timeout_ms(config.per_request_timeout_ms);
        job.deadline_at = decision
            .start
            .then(|| now.saturating_add(total_timeout_ms as i64));
        let task = decision.start.then(|| CloudJobTask {
            conn,
            app: self.app.clone(),
            provider: self.provider.clone(),
            client: self.client.clone(),
            jobs: Arc::clone(&self.recommendation_jobs),
            last_llm_error: Arc::clone(&self.last_recommendation_error),
            publication: Arc::clone(&self.cloud_cancel),
            generation_state: Arc::clone(&self.recommendation_generation),
            generation,
            job_id: job.job_id.clone(),
            query,
            local,
            request_id,
            context,
            candidate_window: config.candidate_window,
            total_timeout_ms,
            fallback_items: visible,
        });
        Ok(PreparedJob {
            generation,
            job,
            task,
        })
    }

    fn local_items_with_request(
        &self,
        query: &RecommendationQuery,
    ) -> Result<(Vec<RecommendationItem>, String), String> {
        let items = self.local_recommendations(query, "local")?;
        let request_id = items
            .first()
            .map(|item| item.request_id.clone())
            .unwrap_or_else(new_request_id);
        Ok((items, request_id))
    }

    fn cloud_job_config(&self) -> CloudJobConfig {
        let fallback = CloudJobConfig {
            candidate_window: MERGED_CANDIDATE_LIMIT,
            per_request_timeout_ms: 8000,
            cache_ttl_ms: 86_400_000,
            configured_at: 0,
        };
        let Ok(conn) = self.conn_handle() else {
            return fallback;
        };
        let guard = conn.lock();
        let configured_at = guard
            .query_row(
                "SELECT updated_at FROM llm_config WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        llm_config::load_config(&guard)
            .map(|config| CloudJobConfig {
                candidate_window: config.max_candidates,
                per_request_timeout_ms: config.timeout_ms,
                cache_ttl_ms: config.cache_ttl_seconds.saturating_mul(1000),
                configured_at,
            })
            .unwrap_or(fallback)
    }

    /// 启动只计算本地候选或读取快照；初始曲库同步后才允许发起模型请求。
    pub(super) fn start_startup_recommendation_job(
        &self,
    ) -> CommandResult<Option<RecommendationJob>> {
        self.db_handle()?;
        if !self.is_recommendation_enabled() {
            return Ok(None);
        }
        self.start_recommendation_job(home_query()).map(Some)
    }

    /// 主动刷新重算本地并请求云端；已有任务复用，请求冷却仍生效。
    pub fn refresh_recommendations(&self) -> CommandResult<Option<RecommendationJob>> {
        self.db_handle()?;
        if !self.is_recommendation_enabled() {
            return Ok(Some(disabled_job()));
        }
        if let Some(job) = self.running_recommendation_job() {
            return Ok(Some(job));
        }
        {
            let _publication_guard = self.cloud_cancel.lock();
            self.cloud_refresh_requested.store(true, Ordering::SeqCst);
        }
        let job = self.start_recommendation_job(home_query())?;
        if matches!(job.status, RecommendationJobStatus::Waiting) && job.next_refresh_at.is_some() {
            self.schedule_dynamic_recommendation_refresh("手动刷新");
        }
        Ok(Some(job))
    }

    pub fn get_latest_recommendation_job(&self) -> CommandResult<Option<RecommendationJob>> {
        self.db_handle()?;
        self.prune_recommendation_jobs();
        if !self.is_recommendation_enabled() {
            return Ok(Some(
                self.latest_recommendation_job()
                    .filter(|job| matches!(job.status, RecommendationJobStatus::Disabled))
                    .unwrap_or_else(disabled_job),
            ));
        }
        Ok(self
            .latest_recommendation_job()
            .or_else(|| self.latest_cloud_recommendation_job("home")))
    }

    pub fn get_recommendation_job(&self, job_id: String) -> Option<RecommendationJob> {
        self.prune_recommendation_jobs();
        self.recommendation_jobs.lock().get(&job_id).cloned()
    }

    fn has_cloud_recommendation_config(&self) -> bool {
        let Ok(conn) = self.conn_handle() else {
            return false;
        };
        let conn = conn.lock();
        let Ok(config) = llm_config::load_config(&conn) else {
            return false;
        };
        config.enabled
            && !config.base_url.trim().is_empty()
            && !config.model.trim().is_empty()
            && crate::recommendation::credential_store::has_api_key(&conn).unwrap_or(false)
    }

    pub(super) fn is_recommendation_enabled(&self) -> bool {
        let Ok(conn) = self.conn_handle() else {
            return false;
        };
        let enabled = llm_config::load_recommendation_enabled(&conn.lock()).unwrap_or(true);
        enabled
    }

    fn latest_recommendation_job(&self) -> Option<RecommendationJob> {
        let current = self.current_job_id.lock().clone();
        let jobs = self.recommendation_jobs.lock();
        current
            .and_then(|id| jobs.get(&id).cloned())
            .or_else(|| jobs.values().cloned().max_by_key(|job| job.updated_at))
    }

    fn running_recommendation_job(&self) -> Option<RecommendationJob> {
        self.recommendation_jobs
            .lock()
            .values()
            .filter(|job| matches!(&job.status, RecommendationJobStatus::Running))
            .cloned()
            .max_by_key(|job| job.updated_at)
    }

    fn has_running_recommendation_job(&self) -> bool {
        self.running_recommendation_job().is_some()
    }

    #[cfg(all(test, windows))]
    fn latest_cloud_recommendation_items(&self, context: &str) -> Option<Vec<RecommendationItem>> {
        self.latest_cloud_recommendation_job(context)
            .map(|job| job.items)
    }

    fn latest_cloud_recommendation_job(&self, context: &str) -> Option<RecommendationJob> {
        let conn = self.conn_handle().ok()?;
        let conn = conn.lock();
        let mut job = match super::storage::load_latest_cloud_recommendation_job(&conn, context) {
            Ok(job) => job?,
            Err(error) => {
                log::warn!("读取云端推荐快照失败: {}", error);
                return None;
            }
        };
        job.items = exclusions::filter_items(&conn, job.items).unwrap_or_else(|error| {
            log::warn!("过滤云端推荐快照失败: {}", error);
            Vec::new()
        });
        Some(job)
    }

    fn prune_recommendation_jobs(&self) {
        let now = catalog::now_ms();
        let current = self.current_job_id.lock().clone();
        self.recommendation_jobs.lock().retain(|id, job| {
            current.as_ref() == Some(id)
                || matches!(&job.status, RecommendationJobStatus::Running)
                || now.saturating_sub(job.updated_at) <= RECOMMENDATION_JOB_TTL_MS
        });
    }
}

fn home_query() -> RecommendationQuery {
    RecommendationQuery {
        limit: Some(30),
        seed: None,
        context: Some("home".to_string()),
    }
}

fn recommendation_context(query: &RecommendationQuery) -> String {
    query
        .context
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(if query.seed.is_some() {
            "similar"
        } else {
            "home"
        })
        .to_string()
}
