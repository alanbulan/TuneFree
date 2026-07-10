use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
        Arc,
    },
};

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};

use super::{
    catalog, db, discovery, events, llm, llm_config, migration,
    model::{
        LibraryDelta, LibraryMembershipChange, LibrarySnapshot, LlmConfigInput, LlmConfigView,
        LlmProviderTestResult, RecSong, RecommendationEvent, RecommendationFeedback,
        RecommendationItem, RecommendationJob, RecommendationJobStage, RecommendationJobStatus,
        RecommendationMaintenanceStats, RecommendationQuery,
    },
    profile,
    provider::OpenAiCompatibleProvider,
    rank, recall, rerank,
};

const RECOMMENDATION_JOB_TTL_MS: i64 = 2 * 60 * 60 * 1000;
const DISCOVERY_QUERY_LIMIT: usize = 6;
const DISCOVERY_RESULTS_PER_SOURCE: usize = 4;
const DISCOVERY_CANDIDATE_LIMIT: usize = 48;
const LOCAL_HEAD_CANDIDATE_LIMIT: usize = 20;
const MERGED_CANDIDATE_LIMIT: usize = 100;
const DYNAMIC_REFRESH_DEBOUNCE_MS: u64 = 20 * 1000;
const DYNAMIC_REFRESH_MIN_INTERVAL_MS: i64 = 3 * 60 * 1000;
const DYNAMIC_REFRESH_RUNNING_RETRY_MS: u64 = 30 * 1000;
const FAVORITE_PROFILE_WEIGHT: f64 = 1.5;
const PLAYLIST_PROFILE_WEIGHT: f64 = 0.6;
const MAINTENANCE_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
const MAINTENANCE_POLL_MS: u64 = 60 * 60 * 1000;
const PLAY_EVENT_RETENTION_MS: i64 = 180 * 24 * 60 * 60 * 1000;
const FEEDBACK_RETENTION_MS: i64 = 90 * 24 * 60 * 60 * 1000;
const LLM_CALL_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const RESULT_SNAPSHOT_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const RESULT_SNAPSHOT_LIMIT: i64 = 20;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct LibraryMembershipKey {
    container_type: String,
    container_id: String,
    track_key: String,
}

#[derive(Clone)]
pub struct RecommendationService {
    conn: Arc<Mutex<Connection>>,
    db_path: PathBuf,
    client: reqwest::Client,
    provider: OpenAiCompatibleProvider,
    last_llm_error: Arc<Mutex<Option<String>>>,
    recommendation_jobs: Arc<Mutex<HashMap<String, RecommendationJob>>>,
    dynamic_refresh_pending: Arc<AtomicBool>,
    last_dynamic_refresh_at: Arc<AtomicI64>,
    recommendation_generation: Arc<AtomicU64>,
}

impl RecommendationService {
    pub fn new(app_handle: tauri::AppHandle, client: reqwest::Client) -> Result<Self, String> {
        let database = match db::open_database(&app_handle) {
            Ok(database) => database,
            Err(e) => {
                log::error!("推荐数据库不可用，使用内存降级模式: {}", e);
                let conn = Connection::open_in_memory()
                    .map_err(|err| format!("创建内存推荐数据库失败: {}", err))?;
                migration::run_migrations(&conn)
                    .map_err(|err| format!("初始化内存推荐数据库失败: {}", err))?;
                db::RecommendationDatabase {
                    conn,
                    path: PathBuf::new(),
                }
            }
        };
        let service = Self {
            conn: Arc::new(Mutex::new(database.conn)),
            db_path: database.path,
            client: client.clone(),
            provider: OpenAiCompatibleProvider::new(client),
            last_llm_error: Arc::new(Mutex::new(None)),
            recommendation_jobs: Arc::new(Mutex::new(HashMap::new())),
            dynamic_refresh_pending: Arc::new(AtomicBool::new(false)),
            last_dynamic_refresh_at: Arc::new(AtomicI64::new(0)),
            recommendation_generation: Arc::new(AtomicU64::new(1)),
        };
        service.schedule_maintenance();
        Ok(service)
    }

    pub fn log_event(&self, event: RecommendationEvent) -> Result<(), String> {
        let event_type = event.event_type.clone();
        let weight = events::event_weight(&event.event_type);
        {
            let conn = self.conn.lock();
            let inserted = events::insert_event(&conn, &event)
                .map_err(|e| format!("写入推荐事件失败: {}", e))?;
            if let Some(song) = &event.song {
                profile::update_profile_for_song(&conn, song, weight, event.quality.as_deref())
                    .map_err(|e| format!("更新推荐画像失败: {}", e))?;
            }
            if event_type == "play_start" {
                events::update_session_cooccurrence_for_event(&conn, &inserted)
                    .map_err(|e| format!("更新播放共现失败: {}", e))?;
            }
        }
        if weight != 0.0 {
            self.invalidate_and_schedule_refresh("用户行为更新");
        }
        Ok(())
    }

    pub fn sync_library(&self, snapshot: LibrarySnapshot) -> Result<(), String> {
        let library_changed = {
            let mut conn = self.conn.lock();
            if let Some(delta) = snapshot.delta.as_ref() {
                apply_library_delta(&mut conn, delta)?
            } else {
                sync_library_snapshot(&mut conn, &snapshot)?
            }
        };

        if library_changed {
            self.invalidate_and_schedule_refresh("曲库同步");
        }
        Ok(())
    }

    pub fn home_recommendations(
        &self,
        query: RecommendationQuery,
    ) -> Result<Vec<RecommendationItem>, String> {
        let conn = self.conn.lock();
        self.local_recommendations(&conn, &query, "local")
    }

    pub fn start_recommendation_job(
        &self,
        query: RecommendationQuery,
    ) -> Result<RecommendationJob, String> {
        self.prune_recommendation_jobs();
        if !self.is_recommendation_enabled() {
            return Ok(RecommendationJob {
                job_id: new_job_id(),
                status: RecommendationJobStatus::Done,
                stage: RecommendationJobStage::Done,
                detail: "智能推荐未启用".to_string(),
                items: Vec::new(),
                error: None,
                updated_at: catalog::now_ms(),
            });
        }
        let context = recommendation_context(&query);
        let persisted_cloud_items = self.latest_cloud_recommendation_items(&context);
        let (local, request_id) = {
            let conn = self.conn.lock();
            let items = self.local_recommendations(&conn, &query, "local")?;
            let request_id = items
                .first()
                .map(|item| item.request_id.clone())
                .unwrap_or_else(new_request_id);
            (items, request_id)
        };
        let can_use_cloud = self.has_cloud_recommendation_config();
        let llm_candidate_window = if can_use_cloud {
            let conn = self.conn.lock();
            llm_config::load_config(&conn)
                .map(|config| config.max_candidates)
                .unwrap_or(MERGED_CANDIDATE_LIMIT)
        } else {
            0
        };
        let visible_items = if can_use_cloud {
            persisted_cloud_items.clone().unwrap_or_default()
        } else {
            local.clone()
        };
        let job_id = new_job_id();
        let job = RecommendationJob {
            job_id: job_id.clone(),
            status: if can_use_cloud {
                RecommendationJobStatus::Running
            } else {
                RecommendationJobStatus::Done
            },
            stage: if can_use_cloud {
                RecommendationJobStage::DiscoveryPlan
            } else if local.is_empty() {
                RecommendationJobStage::Done
            } else {
                RecommendationJobStage::LocalOnly
            },
            detail: if can_use_cloud && !visible_items.is_empty() {
                "已加载最近一次云端智能推荐，后台正在刷新".to_string()
            } else if can_use_cloud && local.is_empty() {
                "本地候选为空，云端正在生成发现方向".to_string()
            } else if can_use_cloud {
                "本地候选已返回，云端正在生成发现方向".to_string()
            } else if local.is_empty() {
                "本地候选为空，云端发现与重排未启用".to_string()
            } else {
                "云端发现与重排未启用，已返回本地推荐".to_string()
            },
            items: visible_items.clone(),
            error: None,
            updated_at: catalog::now_ms(),
        };

        self.recommendation_jobs
            .lock()
            .insert(job_id.clone(), job.clone());
        if !can_use_cloud {
            return Ok(job);
        }
        self.last_dynamic_refresh_at
            .store(catalog::now_ms(), Ordering::SeqCst);

        let conn = Arc::clone(&self.conn);
        let provider = self.provider.clone();
        let client = self.client.clone();
        let jobs = Arc::clone(&self.recommendation_jobs);
        let last_llm_error = Arc::clone(&self.last_llm_error);
        let recommendation_generation = Arc::clone(&self.recommendation_generation);
        let generation = recommendation_generation.load(Ordering::SeqCst);
        let fallback_items = visible_items;
        tauri::async_runtime::spawn(async move {
            update_recommendation_job(
                &jobs,
                &job_id,
                RecommendationJobStatus::Running,
                RecommendationJobStage::DiscoveryPlan,
                "云端正在生成新歌发现方向",
                None,
                None,
            );

            let plan = llm::build_discovery_plan(
                Arc::clone(&conn),
                &provider,
                &query,
                &local,
                &request_id,
                DISCOVERY_QUERY_LIMIT,
            )
            .await;
            if recommendation_generation.load(Ordering::SeqCst) != generation {
                return;
            }
            if let Some(error) = &plan.error {
                *last_llm_error.lock() = Some(error.clone());
            }
            let plan_error = plan.error.clone();

            let discovered = if plan.queries.is_empty() {
                Vec::new()
            } else {
                update_recommendation_job(
                    &jobs,
                    &job_id,
                    RecommendationJobStatus::Running,
                    RecommendationJobStage::PlatformSearch,
                    "正在通过平台搜索验证新歌候选",
                    None,
                    None,
                );
                discovery::discover_songs(
                    client,
                    plan.queries,
                    DISCOVERY_RESULTS_PER_SOURCE,
                    DISCOVERY_CANDIDATE_LIMIT,
                )
                .await
            };
            if recommendation_generation.load(Ordering::SeqCst) != generation {
                return;
            }

            let merged = merge_discovery_candidates(
                local.clone(),
                discovered,
                &request_id,
                llm_candidate_window,
                query.seed.as_ref(),
            );
            if merged.is_empty() {
                let error =
                    plan_error.unwrap_or_else(|| "平台搜索未找到可验证的新歌候选".to_string());
                *last_llm_error.lock() = Some(error.clone());
                update_recommendation_job(
                    &jobs,
                    &job_id,
                    RecommendationJobStatus::Error,
                    RecommendationJobStage::Error,
                    "没有可用于重排的真实候选，保留最近一次云端结果",
                    Some(fallback_items.clone()),
                    Some(error),
                );
                return;
            }

            update_recommendation_job(
                &jobs,
                &job_id,
                RecommendationJobStatus::Running,
                RecommendationJobStage::CloudRerank,
                "云端正在统一重排本地候选和真实新歌候选",
                None,
                None,
            );

            let result = llm::enhance_recommendations(
                Arc::clone(&conn),
                &provider,
                &query,
                merged,
                &request_id,
            )
            .await;
            if recommendation_generation.load(Ordering::SeqCst) != generation {
                return;
            }
            if let Some(error) = result.error.clone() {
                *last_llm_error.lock() = Some(error.clone());
                let items = if fallback_items.is_empty() {
                    result.items
                } else {
                    fallback_items
                };
                update_recommendation_job(
                    &jobs,
                    &job_id,
                    RecommendationJobStatus::Error,
                    RecommendationJobStage::Error,
                    "云端重排失败，保留最近一次可用结果",
                    Some(items),
                    Some(error),
                );
                return;
            }

            let final_items = result.items;
            {
                let guard = conn.lock();
                if recommendation_generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                if let Err(e) = save_cloud_recommendation_result(
                    &guard,
                    &context,
                    &job_id,
                    "已完成本地召回、新歌发现和云端重排",
                    &final_items,
                ) {
                    *last_llm_error.lock() = Some(e);
                }
            }
            update_recommendation_job(
                &jobs,
                &job_id,
                RecommendationJobStatus::Done,
                RecommendationJobStage::Done,
                "已完成本地召回、新歌发现和云端重排",
                Some(final_items),
                None,
            );
        });

        Ok(job)
    }

    pub fn start_startup_recommendation_job(&self) -> Result<Option<RecommendationJob>, String> {
        self.prune_recommendation_jobs();
        if !self.is_recommendation_enabled() {
            return Ok(None);
        }
        if let Some(job) = self.running_recommendation_job() {
            return Ok(Some(job));
        }
        self.start_recommendation_job(RecommendationQuery {
            limit: Some(30),
            seed: None,
            context: Some("home".to_string()),
        })
        .map(Some)
    }

    pub fn get_latest_recommendation_job(&self) -> Option<RecommendationJob> {
        self.prune_recommendation_jobs();
        if !self.is_recommendation_enabled() {
            return None;
        }
        self.latest_recommendation_job()
            .or_else(|| self.latest_cloud_recommendation_job("home"))
    }

    pub fn get_recommendation_job(&self, job_id: String) -> Option<RecommendationJob> {
        self.prune_recommendation_jobs();
        self.recommendation_jobs.lock().get(&job_id).cloned()
    }

    pub fn similar_songs(
        &self,
        song: RecSong,
        limit: Option<usize>,
    ) -> Result<Vec<RecommendationItem>, String> {
        let query = RecommendationQuery {
            limit,
            seed: Some(song),
            context: Some("similar".to_string()),
        };
        let conn = self.conn.lock();
        self.local_recommendations(&conn, &query, "local")
    }

    pub fn dismiss(&self, song: RecSong, reason: Option<String>) -> Result<(), String> {
        {
            let mut conn = self.conn.lock();
            let tx = conn
                .transaction()
                .map_err(|e| format!("开启不感兴趣事务失败: {}", e))?;
            record_dismissal(&tx, &song, reason.as_deref(), "recommendation")?;
            tx.commit()
                .map_err(|e| format!("提交不感兴趣事务失败: {}", e))?;
        }
        self.invalidate_and_schedule_refresh("不感兴趣反馈");
        Ok(())
    }

    pub fn save_feedback(&self, feedback: RecommendationFeedback) -> Result<(), String> {
        {
            let mut conn = self.conn.lock();
            record_recommendation_feedback(&mut conn, &feedback)?;
        }
        self.invalidate_and_schedule_refresh("推荐反馈");
        Ok(())
    }

    pub fn rebuild_index(&self) -> Result<(), String> {
        let mut conn = self.conn.lock();
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启共现索引事务失败: {}", e))?;
        rebuild_cooccurrence_index(&tx).map_err(|e| format!("重建共现索引失败: {}", e))?;
        tx.commit()
            .map_err(|e| format!("提交共现索引事务失败: {}", e))?;
        Ok(())
    }

    pub fn get_llm_config(&self) -> Result<LlmConfigView, String> {
        let conn = self.conn.lock();
        llm_config::view_config(
            &conn,
            self.database_size_bytes(),
            self.last_llm_error.lock().clone(),
        )
    }

    pub fn save_llm_config(&self, config: LlmConfigInput) -> Result<(), String> {
        let conn = self.conn.lock();
        llm_config::save_config(&conn, config)?;
        drop(conn);
        self.invalidate_and_schedule_refresh("推荐配置更新");
        Ok(())
    }

    pub async fn test_llm_provider(
        &self,
        input: Option<LlmConfigInput>,
    ) -> Result<LlmProviderTestResult, String> {
        let (config, api_key) = {
            let input_ref = input.as_ref();
            let config = if let Some(input) = input.clone() {
                llm_config::config_from_input(&input)
            } else {
                let conn = self.conn.lock();
                llm_config::load_config(&conn).map_err(|e| format!("读取模型配置失败: {}", e))?
            };
            let api_key = if input_ref
                .and_then(|value| value.clear_api_key)
                .unwrap_or(false)
            {
                input_ref
                    .and_then(|value| value.api_key.as_deref())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("")
                    .to_string()
            } else {
                match input_ref
                    .and_then(|value| value.api_key.as_deref())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    Some(api_key) => api_key.to_string(),
                    None => {
                        let conn = self.conn.lock();
                        llm_config::get_api_key(&conn)?
                    }
                }
            };
            (config, api_key)
        };
        let result = self.provider.test(&config, &api_key).await;
        *self.last_llm_error.lock() = result.error.clone();
        Ok(result)
    }

    pub fn clear_data(&self) -> Result<RecommendationMaintenanceStats, String> {
        self.recommendation_generation
            .fetch_add(1, Ordering::SeqCst);
        let clear_result = {
            let conn = self.conn.lock();
            clear_recommendation_storage(&conn)
        };
        self.recommendation_jobs.lock().clear();
        self.dynamic_refresh_pending.store(false, Ordering::SeqCst);
        *self.last_llm_error.lock() = None;
        clear_result.map_err(|e| format!("清空推荐数据失败: {}", e))?;
        Ok(self.maintenance_stats())
    }

    pub fn maintenance_stats(&self) -> RecommendationMaintenanceStats {
        let conn = self.conn.lock();
        let llm_cache_entries = conn
            .query_row("SELECT COUNT(*) FROM llm_recommendation_cache", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap_or(0)
            .max(0) as usize;
        RecommendationMaintenanceStats {
            database_size_bytes: self.database_size_bytes(),
            llm_cache_entries,
        }
    }

    fn database_size_bytes(&self) -> u64 {
        std::fs::metadata(&self.db_path)
            .map(|meta| meta.len())
            .unwrap_or(0)
    }

    fn has_cloud_recommendation_config(&self) -> bool {
        let conn = self.conn.lock();
        let Ok(config) = llm_config::load_config(&conn) else {
            return false;
        };
        if !config.enabled || config.base_url.trim().is_empty() || config.model.trim().is_empty() {
            return false;
        }
        llm_config::get_api_key(&conn)
            .map(|key| !key.trim().is_empty())
            .unwrap_or(false)
    }

    fn is_recommendation_enabled(&self) -> bool {
        let conn = self.conn.lock();
        llm_config::load_recommendation_enabled(&conn).unwrap_or(true)
    }

    fn latest_recommendation_job(&self) -> Option<RecommendationJob> {
        self.recommendation_jobs
            .lock()
            .values()
            .cloned()
            .max_by_key(|job| job.updated_at)
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
        self.recommendation_jobs
            .lock()
            .values()
            .any(|job| matches!(&job.status, RecommendationJobStatus::Running))
    }

    fn schedule_maintenance(&self) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let conn = Arc::clone(&service.conn);
                let result = tauri::async_runtime::spawn_blocking(move || {
                    let mut guard = conn.lock();
                    run_recommendation_maintenance(&mut guard)
                })
                .await;
                match result {
                    Ok(Ok(true)) => {
                        log::info!("推荐数据库定期维护已完成并更新推荐状态");
                        service.invalidate_and_schedule_refresh("推荐数据定期维护");
                    }
                    Ok(Ok(false)) => {}
                    Ok(Err(error)) => log::error!("推荐数据库定期维护失败: {}", error),
                    Err(error) => log::error!("推荐数据库维护任务异常: {}", error),
                }
                tokio::time::sleep(std::time::Duration::from_millis(MAINTENANCE_POLL_MS)).await;
            }
        });
    }

    fn invalidate_and_schedule_refresh(&self, reason: &'static str) {
        invalidate_recommendation_state(
            &self.recommendation_generation,
            &self.recommendation_jobs,
            &self.dynamic_refresh_pending,
        );
        self.schedule_dynamic_recommendation_refresh(reason);
    }

    fn schedule_dynamic_recommendation_refresh(&self, reason: &'static str) {
        if !self.is_recommendation_enabled() {
            return;
        }
        if self.dynamic_refresh_pending.swap(true, Ordering::SeqCst) {
            return;
        }

        let service = self.clone();
        let generation = self.recommendation_generation.load(Ordering::SeqCst);
        tauri::async_runtime::spawn(async move {
            let mut delay_ms = DYNAMIC_REFRESH_DEBOUNCE_MS;
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                service.prune_recommendation_jobs();

                if service.recommendation_generation.load(Ordering::SeqCst) != generation {
                    break;
                }
                if !service.is_recommendation_enabled() {
                    break;
                }
                if service.has_running_recommendation_job() {
                    delay_ms = DYNAMIC_REFRESH_RUNNING_RETRY_MS;
                    continue;
                }

                let now = catalog::now_ms();
                let last_refresh = service.last_dynamic_refresh_at.load(Ordering::SeqCst);
                let elapsed = now.saturating_sub(last_refresh);
                if elapsed < DYNAMIC_REFRESH_MIN_INTERVAL_MS {
                    delay_ms = (DYNAMIC_REFRESH_MIN_INTERVAL_MS - elapsed) as u64;
                    continue;
                }

                if let Err(e) = service.start_recommendation_job(RecommendationQuery {
                    limit: Some(30),
                    seed: None,
                    context: Some("home".to_string()),
                }) {
                    log::error!("动态刷新智能推荐失败({}): {}", reason, e);
                } else {
                    log::info!("已触发动态智能推荐刷新: {}", reason);
                }
                break;
            }
            if is_current_generation(
                generation,
                service.recommendation_generation.load(Ordering::SeqCst),
            ) {
                service
                    .dynamic_refresh_pending
                    .store(false, Ordering::SeqCst);
            }
        });
    }

    fn latest_cloud_recommendation_items(&self, context: &str) -> Option<Vec<RecommendationItem>> {
        let conn = self.conn.lock();
        load_latest_cloud_recommendation_job(&conn, context)
            .ok()
            .flatten()
            .map(|job| job.items)
    }

    fn latest_cloud_recommendation_job(&self, context: &str) -> Option<RecommendationJob> {
        let conn = self.conn.lock();
        load_latest_cloud_recommendation_job(&conn, context)
            .ok()
            .flatten()
    }

    fn prune_recommendation_jobs(&self) {
        let now = catalog::now_ms();
        self.recommendation_jobs.lock().retain(|_, job| {
            matches!(&job.status, RecommendationJobStatus::Running)
                || now.saturating_sub(job.updated_at) <= RECOMMENDATION_JOB_TTL_MS
        });
    }

    fn local_recommendations(
        &self,
        conn: &Connection,
        query: &RecommendationQuery,
        recommendation_source: &str,
    ) -> Result<Vec<RecommendationItem>, String> {
        let request_id = new_request_id();
        if let Some(seed) = &query.seed {
            catalog::upsert_track(conn, seed)
                .map_err(|e| format!("保存相似推荐种子失败: {}", e))?;
        }
        let mut candidates = recall::collect_candidates(conn, query.seed.as_ref(), 500)
            .map_err(|e| format!("召回推荐候选失败: {}", e))?;
        if let Some(seed) = query.seed.as_ref() {
            candidates.retain(|candidate| !is_seed_song(&candidate.song, seed));
        }
        candidates = rank::rank_candidates(conn, candidates, query.seed.as_ref())
            .map_err(|e| format!("推荐排序失败: {}", e))?;
        let limit = query.limit.unwrap_or(30).clamp(1, 50);
        let candidates = rerank::mmr(candidates, limit);
        Ok(rerank::to_items(
            candidates,
            &request_id,
            recommendation_source,
        ))
    }
}

fn record_dismissal(
    conn: &Connection,
    song: &RecSong,
    reason: Option<&str>,
    context: &str,
) -> Result<(), String> {
    let key =
        catalog::upsert_track(conn, song).map_err(|e| format!("保存不感兴趣歌曲失败: {}", e))?;
    let now = catalog::now_ms();
    let expires_at = now + 14 * 24 * 60 * 60 * 1000;
    conn.execute(
        r#"
        INSERT INTO dismissed_recommendations (track_key, reason, created_at, expires_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(track_key) DO UPDATE SET
          reason = excluded.reason,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
        "#,
        params![key, reason, now, expires_at],
    )
    .map_err(|e| format!("保存不感兴趣失败: {}", e))?;

    let event = RecommendationEvent {
        event_type: "dismiss".to_string(),
        song: Some(song.clone()),
        session_id: None,
        position_seconds: None,
        duration_seconds: None,
        quality: None,
        context: Some(context.to_string()),
    };
    events::insert_event(conn, &event).map_err(|e| format!("写入不感兴趣事件失败: {}", e))?;
    profile::update_profile_for_song(conn, song, events::event_weight("dismiss"), None)
        .map_err(|e| format!("更新不感兴趣画像失败: {}", e))?;
    Ok(())
}

fn record_recommendation_feedback(
    conn: &mut Connection,
    feedback: &RecommendationFeedback,
) -> Result<(), String> {
    let event_type = match feedback.action.as_str() {
        "play" if feedback.recommendation_source == "hybrid" => "llm_recommend_click",
        "play" if feedback.context.as_deref() == Some("similar") => "similar_click",
        "play" => "recommendation_click",
        "dismiss" => "dismiss",
        _ => return Err("不支持的推荐反馈动作".to_string()),
    };
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启推荐反馈事务失败: {}", e))?;
    let track_key = catalog::upsert_track(&tx, &feedback.song)
        .map_err(|e| format!("保存推荐反馈歌曲失败: {}", e))?;
    tx.execute(
        r#"
        INSERT INTO recommendation_feedback
          (request_id, track_key, action, recommendation_source, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
        params![
            feedback.request_id,
            track_key,
            feedback.action,
            feedback.recommendation_source,
            catalog::now_ms(),
        ],
    )
    .map_err(|e| format!("保存推荐反馈失败: {}", e))?;

    if event_type == "dismiss" {
        record_dismissal(
            &tx,
            &feedback.song,
            Some("not_interested"),
            feedback.context.as_deref().unwrap_or("recommendation"),
        )?;
    } else {
        let event = RecommendationEvent {
            event_type: event_type.to_string(),
            song: Some(feedback.song.clone()),
            session_id: None,
            position_seconds: None,
            duration_seconds: None,
            quality: None,
            context: Some(
                feedback
                    .context
                    .clone()
                    .unwrap_or_else(|| "recommendation".to_string()),
            ),
        };
        events::insert_event(&tx, &event).map_err(|e| format!("写入推荐反馈事件失败: {}", e))?;
        profile::update_profile_for_song(
            &tx,
            &feedback.song,
            events::event_weight(event_type),
            None,
        )
        .map_err(|e| format!("更新推荐反馈画像失败: {}", e))?;
    }
    tx.commit()
        .map_err(|e| format!("提交推荐反馈事务失败: {}", e))
}

fn new_request_id() -> String {
    format!("rec-{}", catalog::now_ms())
}

fn new_job_id() -> String {
    static JOB_SEQ: AtomicU64 = AtomicU64::new(1);
    format!(
        "rec-job-{}-{}",
        catalog::now_ms(),
        JOB_SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

fn is_current_generation(task_generation: u64, current_generation: u64) -> bool {
    task_generation == current_generation
}

fn invalidate_recommendation_state(
    generation: &AtomicU64,
    jobs: &Mutex<HashMap<String, RecommendationJob>>,
    refresh_pending: &AtomicBool,
) {
    generation.fetch_add(1, Ordering::SeqCst);
    let now = catalog::now_ms();
    for job in jobs.lock().values_mut() {
        if matches!(&job.status, RecommendationJobStatus::Running) {
            job.status = RecommendationJobStatus::Done;
            job.stage = RecommendationJobStage::Done;
            job.detail = "推荐数据已更新，当前任务已失效并等待重新生成".to_string();
            job.error = None;
            job.updated_at = now;
        }
    }
    refresh_pending.store(false, Ordering::SeqCst);
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

fn load_latest_cloud_recommendation_job(
    conn: &Connection,
    context: &str,
) -> rusqlite::Result<Option<RecommendationJob>> {
    conn.query_row(
        r#"
        SELECT job_id, detail, items_json, created_at
        FROM recommendation_result_snapshots
        WHERE context = ?1 AND result_source = 'cloud'
        ORDER BY created_at DESC
        LIMIT 1
        "#,
        params![context],
        |row| {
            let job_id: String = row.get(0)?;
            let detail: String = row.get(1)?;
            let items_json: String = row.get(2)?;
            let updated_at: i64 = row.get(3)?;
            let items =
                serde_json::from_str::<Vec<RecommendationItem>>(&items_json).unwrap_or_default();
            Ok(RecommendationJob {
                job_id,
                status: RecommendationJobStatus::Done,
                stage: RecommendationJobStage::Done,
                detail,
                items,
                error: None,
                updated_at,
            })
        },
    )
    .optional()
}

fn save_cloud_recommendation_result(
    conn: &Connection,
    context: &str,
    job_id: &str,
    detail: &str,
    items: &[RecommendationItem],
) -> Result<(), String> {
    let items_json =
        serde_json::to_string(items).map_err(|e| format!("序列化云端推荐结果失败: {}", e))?;
    conn.execute(
        r#"
        INSERT INTO recommendation_result_snapshots (
          context, result_source, job_id, detail, items_json, created_at
        ) VALUES (?1, 'cloud', ?2, ?3, ?4, ?5)
        "#,
        params![context, job_id, detail, items_json, catalog::now_ms()],
    )
    .map(|_| ())
    .map_err(|e| format!("保存云端推荐结果失败: {}", e))
}

fn clear_recommendation_storage(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        DELETE FROM play_events;
        DELETE FROM user_profile;
        DELETE FROM library_profile;
        DELETE FROM item_cooccurrence;
        DELETE FROM library_membership;
        DELETE FROM recommendation_cache;
        DELETE FROM recommendation_result_snapshots;
        DELETE FROM dismissed_recommendations;
        DELETE FROM recommendation_feedback;
        DELETE FROM llm_recommendation_cache;
        DELETE FROM llm_calls;
        "#,
    )
}

fn run_recommendation_maintenance(conn: &mut Connection) -> Result<bool, String> {
    run_recommendation_maintenance_at(conn, catalog::now_ms())
}

fn run_recommendation_maintenance_at(conn: &mut Connection, now: i64) -> Result<bool, String> {
    let last_run_at = conn
        .query_row(
            "SELECT last_run_at FROM recommendation_maintenance WHERE id = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| format!("读取推荐维护时间失败: {}", e))?
        .unwrap_or(0);
    if now.saturating_sub(last_run_at) < MAINTENANCE_INTERVAL_MS {
        return Ok(false);
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("开启推荐维护事务失败: {}", e))?;
    let removed_play_events = tx
        .execute(
            "DELETE FROM play_events WHERE created_at < ?1",
            [now - PLAY_EVENT_RETENTION_MS],
        )
        .map_err(|e| format!("清理历史播放事件失败: {}", e))?;
    tx.execute(
        "DELETE FROM recommendation_feedback WHERE created_at < ?1",
        [now - FEEDBACK_RETENTION_MS],
    )
    .map_err(|e| format!("清理历史推荐反馈失败: {}", e))?;
    tx.execute(
        "DELETE FROM llm_calls WHERE created_at < ?1",
        [now - LLM_CALL_RETENTION_MS],
    )
    .map_err(|e| format!("清理模型调用日志失败: {}", e))?;
    tx.execute(
        "DELETE FROM recommendation_cache WHERE generated_at < ?1",
        [now - RESULT_SNAPSHOT_RETENTION_MS],
    )
    .map_err(|e| format!("清理历史本地推荐缓存失败: {}", e))?;
    tx.execute(
        "DELETE FROM llm_recommendation_cache WHERE expires_at <= ?1",
        [now],
    )
    .map_err(|e| format!("清理过期模型缓存失败: {}", e))?;
    let removed_dismissals = tx
        .execute(
            "DELETE FROM dismissed_recommendations WHERE expires_at <= ?1",
            [now],
        )
        .map_err(|e| format!("清理过期不感兴趣记录失败: {}", e))?;
    tx.execute(
        "DELETE FROM recommendation_result_snapshots WHERE created_at < ?1",
        [now - RESULT_SNAPSHOT_RETENTION_MS],
    )
    .map_err(|e| format!("清理过期推荐结果失败: {}", e))?;
    tx.execute(
        r#"
        DELETE FROM recommendation_result_snapshots
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                     PARTITION BY context, result_source
                     ORDER BY created_at DESC, id DESC
                   ) AS row_number
            FROM recommendation_result_snapshots
          ) ranked
          WHERE row_number > ?1
        )
        "#,
        [RESULT_SNAPSHOT_LIMIT],
    )
    .map_err(|e| format!("清理历史推荐结果失败: {}", e))?;

    profile::rebuild_profile_from_events(&tx)
        .map_err(|e| format!("重建保留期推荐画像失败: {}", e))?;
    rebuild_cooccurrence_index(&tx).map_err(|e| format!("重建保留期共现失败: {}", e))?;
    tx.execute(
        r#"
        DELETE FROM tracks
        WHERE last_seen_at < ?1
          AND NOT EXISTS (
            SELECT 1 FROM library_membership m WHERE m.track_key = tracks.track_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM play_events e WHERE e.track_key = tracks.track_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM recommendation_feedback f WHERE f.track_key = tracks.track_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM dismissed_recommendations d WHERE d.track_key = tracks.track_key
          )
        "#,
        [now - PLAY_EVENT_RETENTION_MS],
    )
    .map_err(|e| format!("清理孤立推荐歌曲失败: {}", e))?;
    tx.execute(
        r#"
        INSERT INTO recommendation_maintenance (id, last_run_at)
        VALUES (1, ?1)
        ON CONFLICT(id) DO UPDATE SET last_run_at = excluded.last_run_at
        "#,
        [now],
    )
    .map_err(|e| format!("保存推荐维护时间失败: {}", e))?;
    tx.commit()
        .map_err(|e| format!("提交推荐维护事务失败: {}", e))?;
    Ok(removed_play_events > 0 || removed_dismissals > 0)
}

fn update_recommendation_job(
    jobs: &Arc<Mutex<HashMap<String, RecommendationJob>>>,
    job_id: &str,
    status: RecommendationJobStatus,
    stage: RecommendationJobStage,
    detail: &str,
    items: Option<Vec<RecommendationItem>>,
    error: Option<String>,
) {
    if let Some(job) = jobs.lock().get_mut(job_id) {
        if !matches!(&job.status, RecommendationJobStatus::Running) {
            return;
        }
        job.status = status;
        job.stage = stage;
        job.detail = detail.to_string();
        if let Some(items) = items {
            job.items = items;
        }
        job.error = error;
        job.updated_at = catalog::now_ms();
    }
}

fn merge_discovery_candidates(
    local_items: Vec<RecommendationItem>,
    discovered: Vec<discovery::DiscoveredSong>,
    request_id: &str,
    llm_candidate_window: usize,
    seed: Option<&RecSong>,
) -> Vec<RecommendationItem> {
    let mut merged = Vec::new();
    let mut seen_track_keys = std::collections::HashSet::new();
    let mut seen_identities = std::collections::HashSet::new();

    let discovery_items: Vec<RecommendationItem> = discovered
        .into_iter()
        .map(|item| {
            let reason = discovery::discovery_reason(&item.reason);
            RecommendationItem {
                song: item.song,
                score: 0.45,
                reasons: vec![reason, "平台搜索验证".to_string()],
                recommendation_source: "discovery".to_string(),
                request_id: request_id.to_string(),
            }
        })
        .collect();
    let candidate_window = llm_candidate_window.clamp(1, MERGED_CANDIDATE_LIMIT);
    let discovery_window_target = if discovery_items.is_empty() {
        0
    } else {
        (candidate_window / 2).max(1).min(discovery_items.len())
    };
    let local_anchor_limit = if discovery_window_target == 0 {
        LOCAL_HEAD_CANDIDATE_LIMIT.min(candidate_window)
    } else {
        candidate_window
            .saturating_sub(discovery_window_target)
            .min(LOCAL_HEAD_CANDIDATE_LIMIT)
    };

    // Keep verified discovery candidates inside the LLM rerank window even when max_candidates is small.
    for item in local_items.iter().take(local_anchor_limit) {
        push_candidate(
            &mut merged,
            &mut seen_track_keys,
            &mut seen_identities,
            item.clone(),
        );
    }

    for item in discovery_items.iter().take(discovery_window_target) {
        push_candidate(
            &mut merged,
            &mut seen_track_keys,
            &mut seen_identities,
            item.clone(),
        );
        if merged.len() >= MERGED_CANDIDATE_LIMIT {
            return merged;
        }
    }

    for item in local_items
        .iter()
        .skip(local_anchor_limit)
        .take(LOCAL_HEAD_CANDIDATE_LIMIT.saturating_sub(local_anchor_limit))
    {
        push_candidate(
            &mut merged,
            &mut seen_track_keys,
            &mut seen_identities,
            item.clone(),
        );
        if merged.len() >= MERGED_CANDIDATE_LIMIT {
            return merged;
        }
    }

    for item in discovery_items.into_iter().skip(discovery_window_target) {
        push_candidate(
            &mut merged,
            &mut seen_track_keys,
            &mut seen_identities,
            item,
        );
        if merged.len() >= MERGED_CANDIDATE_LIMIT {
            return merged;
        }
    }

    for item in local_items.into_iter().skip(LOCAL_HEAD_CANDIDATE_LIMIT) {
        push_candidate(
            &mut merged,
            &mut seen_track_keys,
            &mut seen_identities,
            item,
        );
        if merged.len() >= MERGED_CANDIDATE_LIMIT {
            break;
        }
    }

    if let Some(seed) = seed {
        merged.retain(|item| !is_seed_song(&item.song, seed));
    }

    merged
}

fn is_seed_song(song: &RecSong, seed: &RecSong) -> bool {
    catalog::track_key(song) == catalog::track_key(seed)
        || catalog::song_identity(song) == catalog::song_identity(seed)
}

fn push_candidate(
    merged: &mut Vec<RecommendationItem>,
    seen_track_keys: &mut std::collections::HashSet<String>,
    seen_identities: &mut std::collections::HashSet<String>,
    item: RecommendationItem,
) {
    let track_key = catalog::track_key(&item.song);
    let identity = catalog::song_identity(&item.song);
    if !seen_track_keys.insert(track_key) || !seen_identities.insert(identity) {
        return;
    }
    merged.push(item);
}

fn sync_library_snapshot(
    conn: &mut Connection,
    snapshot: &LibrarySnapshot,
) -> Result<bool, String> {
    let (new_memberships, library_tracks) = build_library_memberships(snapshot);
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启曲库同步事务失败: {}", e))?;
    let old_memberships =
        load_library_memberships(&tx).map_err(|e| format!("读取曲库成员失败: {}", e))?;
    let added_memberships = new_memberships
        .difference(&old_memberships)
        .cloned()
        .collect::<Vec<_>>();
    let removed_memberships = old_memberships
        .difference(&new_memberships)
        .cloned()
        .collect::<Vec<_>>();
    let mut upsert_songs = Vec::new();
    for (track_key, song) in &library_tracks {
        let existing =
            catalog::get_track(&tx, track_key).map_err(|e| format!("读取曲库歌曲失败: {}", e))?;
        if existing
            .as_ref()
            .map(|current| !song_metadata_equal(current, song))
            .unwrap_or(true)
        {
            upsert_songs.push(song.clone());
        }
    }
    let library_changed =
        apply_library_changes(&tx, &upsert_songs, &added_memberships, &removed_memberships)?;

    for song in &snapshot.queue {
        catalog::upsert_track(&tx, song).map_err(|e| format!("同步播放队列失败: {}", e))?;
    }
    if let Some(song) = &snapshot.current_song {
        catalog::upsert_track(&tx, song).map_err(|e| format!("同步当前歌曲失败: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("提交曲库同步事务失败: {}", e))?;
    Ok(library_changed)
}

fn apply_library_delta(conn: &mut Connection, delta: &LibraryDelta) -> Result<bool, String> {
    let added_memberships = delta
        .added_memberships
        .iter()
        .map(library_membership_from_change)
        .collect::<Result<Vec<_>, _>>()?;
    let removed_memberships = delta
        .removed_memberships
        .iter()
        .map(library_membership_from_change)
        .collect::<Result<Vec<_>, _>>()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启曲库增量同步事务失败: {}", e))?;
    let changed = apply_library_changes(
        &tx,
        &delta.upsert_songs,
        &added_memberships,
        &removed_memberships,
    )?;
    tx.commit()
        .map_err(|e| format!("提交曲库增量同步事务失败: {}", e))?;
    Ok(changed)
}

fn apply_library_changes(
    conn: &Connection,
    upsert_songs: &[RecSong],
    added_memberships: &[LibraryMembershipKey],
    removed_memberships: &[LibraryMembershipKey],
) -> Result<bool, String> {
    if upsert_songs.is_empty() && added_memberships.is_empty() && removed_memberships.is_empty() {
        return Ok(false);
    }

    let mut affected_keys = HashSet::new();
    affected_keys.extend(upsert_songs.iter().map(catalog::track_key));
    affected_keys.extend(
        added_memberships
            .iter()
            .map(|membership| membership.track_key.clone()),
    );
    affected_keys.extend(
        removed_memberships
            .iter()
            .map(|membership| membership.track_key.clone()),
    );

    for track_key in &affected_keys {
        if let Some(song) = catalog::get_track(conn, track_key)
            .map_err(|e| format!("读取变更前曲库歌曲失败: {}", e))?
        {
            apply_membership_profile(conn, track_key, &song, -1.0)?;
        }
    }

    for membership in removed_memberships {
        conn.execute(
            "DELETE FROM library_membership WHERE container_type = ?1 AND container_id = ?2 AND track_key = ?3",
            params![
                &membership.container_type,
                &membership.container_id,
                &membership.track_key,
            ],
        )
        .map_err(|e| format!("删除曲库成员失败: {}", e))?;
    }

    for song in upsert_songs {
        catalog::upsert_track(conn, song).map_err(|e| format!("更新曲库歌曲失败: {}", e))?;
    }

    let now = catalog::now_ms();
    for membership in added_memberships {
        let track_exists = catalog::get_track(conn, &membership.track_key)
            .map_err(|e| format!("检查曲库歌曲失败: {}", e))?
            .is_some();
        if !track_exists {
            return Err(format!(
                "新增曲库成员缺少歌曲信息: {}",
                membership.track_key
            ));
        }
        conn.execute(
            r#"
            INSERT OR IGNORE INTO library_membership
              (container_type, container_id, track_key, updated_at)
            VALUES (?1, ?2, ?3, ?4)
            "#,
            params![
                &membership.container_type,
                &membership.container_id,
                &membership.track_key,
                now,
            ],
        )
        .map_err(|e| format!("新增曲库成员失败: {}", e))?;
    }

    for track_key in &affected_keys {
        if let Some(song) = catalog::get_track(conn, track_key)
            .map_err(|e| format!("读取变更后曲库歌曲失败: {}", e))?
        {
            apply_membership_profile(conn, track_key, &song, 1.0)?;
        }
    }
    profile::prune_library_profile(conn).map_err(|e| format!("清理曲库画像失败: {}", e))?;
    Ok(true)
}

fn apply_membership_profile(
    conn: &Connection,
    track_key: &str,
    song: &RecSong,
    direction: f64,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT container_type FROM library_membership WHERE track_key = ?1")
        .map_err(|e| format!("读取曲库成员画像失败: {}", e))?;
    let memberships = stmt
        .query_map([track_key], |row| row.get::<_, String>(0))
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|e| format!("读取曲库成员画像失败: {}", e))?;
    for container_type in memberships {
        profile::add_library_profile_for_song(
            conn,
            song,
            direction * membership_profile_weight(&container_type),
            None,
        )
        .map_err(|e| format!("更新曲库画像失败: {}", e))?;
    }
    Ok(())
}

fn library_membership_from_change(
    change: &LibraryMembershipChange,
) -> Result<LibraryMembershipKey, String> {
    if !matches!(change.container_type.as_str(), "favorite" | "playlist")
        || change.container_id.trim().is_empty()
        || change.track_key.trim().is_empty()
    {
        return Err("曲库增量成员参数无效".to_string());
    }
    Ok(LibraryMembershipKey {
        container_type: change.container_type.clone(),
        container_id: change.container_id.clone(),
        track_key: change.track_key.clone(),
    })
}

fn song_metadata_equal(left: &RecSong, right: &RecSong) -> bool {
    left.source == right.source
        && left.name == right.name
        && left.artist == right.artist
        && left.album == right.album
        && left.pic == right.pic
        && left.url_id == right.url_id
        && left.lyric_id == right.lyric_id
        && left.types == right.types
}

fn build_library_memberships(
    snapshot: &LibrarySnapshot,
) -> (HashSet<LibraryMembershipKey>, HashMap<String, RecSong>) {
    let mut memberships = HashSet::new();
    let mut tracks = HashMap::new();

    for song in &snapshot.favorites {
        let track_key = catalog::track_key(song);
        tracks.insert(track_key.clone(), song.clone());
        memberships.insert(LibraryMembershipKey {
            container_type: "favorite".to_string(),
            container_id: "favorites".to_string(),
            track_key,
        });
    }

    for playlist in &snapshot.playlists {
        for song in &playlist.songs {
            let track_key = catalog::track_key(song);
            tracks.insert(track_key.clone(), song.clone());
            memberships.insert(LibraryMembershipKey {
                container_type: "playlist".to_string(),
                container_id: playlist.id.clone(),
                track_key,
            });
        }
    }

    (memberships, tracks)
}

fn load_library_memberships(conn: &Connection) -> rusqlite::Result<HashSet<LibraryMembershipKey>> {
    let mut stmt =
        conn.prepare("SELECT container_type, container_id, track_key FROM library_membership")?;
    let rows = stmt.query_map([], |row| {
        Ok(LibraryMembershipKey {
            container_type: row.get(0)?,
            container_id: row.get(1)?,
            track_key: row.get(2)?,
        })
    })?;
    rows.collect()
}

fn membership_profile_weight(container_type: &str) -> f64 {
    match container_type {
        "favorite" => FAVORITE_PROFILE_WEIGHT,
        "playlist" => PLAYLIST_PROFILE_WEIGHT,
        _ => 0.0,
    }
}

fn rebuild_cooccurrence_index(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM item_cooccurrence", [])?;
    events::rebuild_session_cooccurrence(conn)
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::recommendation::model::{PlaylistSnapshot, RecommendationEvent};

    fn song(source: &str, id: &str, name: &str, artist: &str) -> RecSong {
        RecSong {
            id: Value::String(id.to_string()),
            source: source.to_string(),
            name: name.to_string(),
            artist: artist.to_string(),
            album: "测试专辑".to_string(),
            pic: None,
            pic_id: None,
            url_id: None,
            lyric_id: None,
            types: None,
        }
    }

    fn recommendation_item(source: &str, id: &str, name: &str) -> RecommendationItem {
        RecommendationItem {
            song: RecSong {
                id: Value::String(id.to_string()),
                source: source.to_string(),
                name: name.to_string(),
                artist: "测试歌手".to_string(),
                album: "测试专辑".to_string(),
                pic: None,
                pic_id: None,
                url_id: None,
                lyric_id: None,
                types: None,
            },
            score: 0.8,
            reasons: vec!["本地候选".to_string()],
            recommendation_source: "local".to_string(),
            request_id: "req-test".to_string(),
        }
    }

    fn discovered_song(id: &str, name: &str) -> discovery::DiscoveredSong {
        discovery::DiscoveredSong {
            song: RecSong {
                id: Value::String(id.to_string()),
                source: "netease".to_string(),
                name: name.to_string(),
                artist: "新歌手".to_string(),
                album: "新专辑".to_string(),
                pic: None,
                pic_id: None,
                url_id: None,
                lyric_id: None,
                types: None,
            },
            reason: "云端发现".to_string(),
        }
    }

    #[test]
    fn merge_keeps_discovery_candidates_inside_llm_window() {
        let local_items: Vec<_> = (0..20)
            .map(|index| {
                recommendation_item("local", &index.to_string(), &format!("本地歌{index}"))
            })
            .collect();
        let discovered: Vec<_> = (0..5)
            .map(|index| discovered_song(&format!("new-{index}"), &format!("新歌{index}")))
            .collect();

        let merged = merge_discovery_candidates(local_items, discovered, "req-test", 12, None);
        let first_window = merged.iter().take(12).collect::<Vec<_>>();
        let discovery_count = first_window
            .iter()
            .filter(|item| item.recommendation_source == "discovery")
            .count();

        assert_eq!(discovery_count, 5);
    }

    #[test]
    fn seed_identity_is_excluded_across_sources() {
        let seed = song("netease", "1", "同一首歌", "同一歌手");
        let same_source = song("netease", "1", "同一首歌", "同一歌手");
        let cross_source = song("qq", "other", " 同一首歌 ", "同一歌手");
        let other = song("qq", "2", "另一首歌", "同一歌手");

        assert!(is_seed_song(&same_source, &seed));
        assert!(is_seed_song(&cross_source, &seed));
        assert!(!is_seed_song(&other, &seed));
    }

    #[test]
    fn library_sync_is_idempotent_and_removal_reverses_profile() {
        let mut conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let favorite = song("netease", "1", "收藏歌", "收藏歌手");
        let playlist_song = song("qq", "2", "歌单歌", "歌单歌手");
        let snapshot = LibrarySnapshot {
            favorites: vec![favorite.clone()],
            playlists: vec![PlaylistSnapshot {
                id: "playlist-1".to_string(),
                name: "测试歌单".to_string(),
                songs: vec![playlist_song.clone()],
            }],
            queue: Vec::new(),
            current_song: None,
            delta: None,
        };

        assert!(sync_library_snapshot(&mut conn, &snapshot).unwrap());
        let profile_before: Vec<(String, f64)> = {
            let mut stmt = conn
                .prepare("SELECT key, value FROM library_profile ORDER BY key")
                .unwrap();
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        profile::update_profile_for_song(&conn, &favorite, 1.0, None).unwrap();
        let library_profile_after_behavior: Vec<(String, f64)> = {
            let mut stmt = conn
                .prepare("SELECT key, value FROM library_profile ORDER BY key")
                .unwrap();
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        assert_eq!(profile_before, library_profile_after_behavior);
        let cooccurrence_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM item_cooccurrence", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert!(!sync_library_snapshot(&mut conn, &snapshot).unwrap());
        let profile_after: Vec<(String, f64)> = {
            let mut stmt = conn
                .prepare("SELECT key, value FROM library_profile ORDER BY key")
                .unwrap();
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        let cooccurrence_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM item_cooccurrence", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(profile_before, profile_after);
        assert_eq!(cooccurrence_before, cooccurrence_after);

        let empty_snapshot = LibrarySnapshot {
            favorites: Vec::new(),
            playlists: Vec::new(),
            queue: Vec::new(),
            current_song: None,
            delta: None,
        };
        assert!(sync_library_snapshot(&mut conn, &empty_snapshot).unwrap());
        let favorite_artist_value: Option<f64> = conn
            .query_row(
                "SELECT value FROM library_profile WHERE key = 'artist:收藏歌手'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert!(favorite_artist_value.is_none());
    }

    #[test]
    fn library_delta_updates_metadata_and_reverses_removed_membership() {
        let mut conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let original = song("netease", "1", "旧歌名", "旧歌手");
        let snapshot = LibrarySnapshot {
            favorites: vec![original.clone()],
            playlists: Vec::new(),
            queue: Vec::new(),
            current_song: None,
            delta: None,
        };
        sync_library_snapshot(&mut conn, &snapshot).unwrap();

        let updated = song("netease", "1", "新歌名", "新歌手");
        let update_delta = LibraryDelta {
            upsert_songs: vec![updated.clone()],
            added_memberships: Vec::new(),
            removed_memberships: Vec::new(),
        };
        assert!(apply_library_delta(&mut conn, &update_delta).unwrap());
        let stored = catalog::get_track(&conn, "netease:1").unwrap().unwrap();
        assert_eq!(stored.name, "新歌名");
        assert_eq!(stored.artist, "新歌手");
        let old_artist: Option<f64> = conn
            .query_row(
                "SELECT value FROM library_profile WHERE key = 'artist:旧歌手'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert!(old_artist.is_none());

        let remove_delta = LibraryDelta {
            upsert_songs: Vec::new(),
            added_memberships: Vec::new(),
            removed_memberships: vec![LibraryMembershipChange {
                container_type: "favorite".to_string(),
                container_id: "favorites".to_string(),
                track_key: "netease:1".to_string(),
            }],
        };
        assert!(apply_library_delta(&mut conn, &remove_delta).unwrap());
        let membership_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM library_membership", [], |row| {
                row.get(0)
            })
            .unwrap();
        let new_artist: Option<f64> = conn
            .query_row(
                "SELECT value FROM library_profile WHERE key = 'artist:新歌手'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert_eq!(membership_count, 0);
        assert!(new_artist.is_none());
    }

    #[test]
    fn recommendation_feedback_is_atomic_and_updates_algorithm_once() {
        let mut conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let recommended_song = song("netease", "1", "推荐歌", "推荐歌手");
        let feedback = RecommendationFeedback {
            request_id: "request-1".to_string(),
            song: recommended_song.clone(),
            action: "play".to_string(),
            recommendation_source: "hybrid".to_string(),
            context: Some("home".to_string()),
        };

        record_recommendation_feedback(&mut conn, &feedback).unwrap();
        let feedback_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM recommendation_feedback", [], |row| {
                row.get(0)
            })
            .unwrap();
        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM play_events WHERE event_type = 'llm_recommend_click'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let profile_value: f64 = conn
            .query_row(
                "SELECT value FROM user_profile WHERE key = 'artist:推荐歌手'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(feedback_count, 1);
        assert_eq!(event_count, 1);
        assert!(profile_value > 0.0);

        let invalid = RecommendationFeedback {
            action: "unknown".to_string(),
            ..feedback
        };
        assert!(record_recommendation_feedback(&mut conn, &invalid).is_err());
        let counts: (i64, i64) = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM recommendation_feedback), (SELECT COUNT(*) FROM play_events)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts, (1, 1));
    }

    #[test]
    fn generic_and_similar_recommendation_clicks_keep_distinct_semantics() {
        let mut conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let recommended_song = song("netease", "1", "推荐歌", "推荐歌手");
        for (context, expected_event) in [
            ("home", "recommendation_click"),
            ("similar", "similar_click"),
        ] {
            record_recommendation_feedback(
                &mut conn,
                &RecommendationFeedback {
                    request_id: format!("request-{context}"),
                    song: recommended_song.clone(),
                    action: "play".to_string(),
                    recommendation_source: "local".to_string(),
                    context: Some(context.to_string()),
                },
            )
            .unwrap();
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM play_events WHERE event_type = ?1",
                    [expected_event],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1);
        }
    }

    #[test]
    fn large_playlist_is_recalled_without_materialized_quadratic_pairs() {
        let mut conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let songs = (0..1000)
            .map(|index| song("netease", &index.to_string(), &format!("歌{index}"), "歌手"))
            .collect::<Vec<_>>();
        let snapshot = LibrarySnapshot {
            favorites: Vec::new(),
            playlists: vec![PlaylistSnapshot {
                id: "large".to_string(),
                name: "大歌单".to_string(),
                songs: songs.clone(),
            }],
            queue: Vec::new(),
            current_song: None,
            delta: None,
        };
        sync_library_snapshot(&mut conn, &snapshot).unwrap();
        let pair_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM item_cooccurrence", [], |row| {
                row.get(0)
            })
            .unwrap();
        let candidates = recall::collect_candidates(&conn, Some(&songs[0]), 100).unwrap();

        assert_eq!(pair_count, 0);
        assert!(candidates.iter().any(|candidate| {
            candidate.track_key != "netease:0"
                && candidate
                    .reasons
                    .iter()
                    .any(|reason| reason == "来自你的歌单共现")
        }));
    }

    #[test]
    fn maintenance_enforces_time_boundaries_and_snapshot_cap() {
        let mut conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let now = 2_000_000_000_000_i64;
        let track = song("netease", "1", "保留歌曲", "保留歌手");
        let track_key = catalog::upsert_track(&conn, &track).unwrap();
        for created_at in [
            now - PLAY_EVENT_RETENTION_MS - 1,
            now - PLAY_EVENT_RETENTION_MS,
        ] {
            conn.execute(
                "INSERT INTO play_events (event_type, track_key, session_id, weight, created_at) VALUES ('play_complete', ?1, 'playback:test', 4.0, ?2)",
                params![track_key, created_at],
            )
            .unwrap();
        }
        for created_at in [now - FEEDBACK_RETENTION_MS - 1, now - FEEDBACK_RETENTION_MS] {
            conn.execute(
                "INSERT INTO recommendation_feedback (request_id, track_key, action, recommendation_source, created_at) VALUES ('r', ?1, 'play', 'local', ?2)",
                params![track_key, created_at],
            )
            .unwrap();
        }
        for index in 0..25 {
            conn.execute(
                "INSERT INTO recommendation_result_snapshots (context, result_source, job_id, detail, items_json, created_at) VALUES ('home', 'cloud', ?1, '', '[]', ?2)",
                params![format!("recent-{index}"), now - index],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO recommendation_result_snapshots (context, result_source, job_id, detail, items_json, created_at) VALUES ('boundary', 'cloud', 'boundary', '', '[]', ?1)",
            [now - RESULT_SNAPSHOT_RETENTION_MS],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO recommendation_result_snapshots (context, result_source, job_id, detail, items_json, created_at) VALUES ('other', 'cloud', 'expired', '', '[]', ?1)",
            [now - RESULT_SNAPSHOT_RETENTION_MS - 1],
        )
        .unwrap();

        assert!(run_recommendation_maintenance_at(&mut conn, now).unwrap());
        let event_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM play_events", [], |row| row.get(0))
            .unwrap();
        let feedback_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM recommendation_feedback", [], |row| {
                row.get(0)
            })
            .unwrap();
        let home_snapshot_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM recommendation_result_snapshots WHERE context = 'home'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let expired_snapshot_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM recommendation_result_snapshots WHERE job_id = 'expired'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let boundary_snapshot_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM recommendation_result_snapshots WHERE job_id = 'boundary'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(event_count, 1);
        assert_eq!(feedback_count, 1);
        assert_eq!(home_snapshot_count, RESULT_SNAPSHOT_LIMIT);
        assert_eq!(expired_snapshot_count, 0);
        assert_eq!(boundary_snapshot_count, 1);
        assert!(!run_recommendation_maintenance_at(&mut conn, now).unwrap());
    }

    #[test]
    fn session_cooccurrence_ignores_legacy_sessions_and_uses_bounded_window() {
        let conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let songs: Vec<_> = (0..7)
            .map(|index| song("netease", &index.to_string(), &format!("歌{index}"), "歌手"))
            .collect();

        let legacy = RecommendationEvent {
            event_type: "play_start".to_string(),
            song: Some(songs[0].clone()),
            session_id: None,
            position_seconds: Some(0.0),
            duration_seconds: None,
            quality: None,
            context: Some("playback".to_string()),
        };
        events::insert_event(&conn, &legacy).unwrap();

        for item in &songs {
            let event = RecommendationEvent {
                event_type: "play_start".to_string(),
                song: Some(item.clone()),
                session_id: Some("playback:a".to_string()),
                position_seconds: Some(0.0),
                duration_seconds: None,
                quality: None,
                context: Some("playback".to_string()),
            };
            events::insert_event(&conn, &event).unwrap();
        }
        let other_session_song = song("qq", "other", "其它会话", "其它歌手");
        let other_session = RecommendationEvent {
            event_type: "play_start".to_string(),
            song: Some(other_session_song.clone()),
            session_id: Some("playback:b".to_string()),
            position_seconds: Some(0.0),
            duration_seconds: None,
            quality: None,
            context: Some("playback".to_string()),
        };
        events::insert_event(&conn, &other_session).unwrap();

        rebuild_cooccurrence_index(&conn).unwrap();
        let first_key = catalog::track_key(&songs[0]);
        let second_key = catalog::track_key(&songs[1]);
        let seventh_key = catalog::track_key(&songs[6]);
        let other_key = catalog::track_key(&other_session_song);
        let pair_count = |related: &str| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM item_cooccurrence WHERE track_key = ?1 AND related_track_key = ?2",
                params![first_key, related],
                |row| row.get(0),
            )
            .unwrap()
        };

        assert_eq!(pair_count(&second_key), 1);
        assert_eq!(pair_count(&seventh_key), 0);
        assert_eq!(pair_count(&other_key), 0);
    }

    #[test]
    fn stale_dynamic_refresh_task_does_not_clear_new_generation() {
        assert!(is_current_generation(2, 2));
        assert!(!is_current_generation(1, 2));

        let generation = AtomicU64::new(2);
        let pending = AtomicBool::new(true);
        let jobs = Mutex::new(HashMap::from([
            (
                "running".to_string(),
                RecommendationJob {
                    job_id: "running".to_string(),
                    status: RecommendationJobStatus::Running,
                    stage: RecommendationJobStage::CloudRerank,
                    detail: String::new(),
                    items: Vec::new(),
                    error: None,
                    updated_at: 1,
                },
            ),
            (
                "done".to_string(),
                RecommendationJob {
                    job_id: "done".to_string(),
                    status: RecommendationJobStatus::Done,
                    stage: RecommendationJobStage::Done,
                    detail: String::new(),
                    items: Vec::new(),
                    error: None,
                    updated_at: 1,
                },
            ),
        ]));
        invalidate_recommendation_state(&generation, &jobs, &pending);
        assert_eq!(generation.load(Ordering::SeqCst), 3);
        assert!(!pending.load(Ordering::SeqCst));
        assert!(matches!(
            &jobs.lock().get("running").unwrap().status,
            RecommendationJobStatus::Done
        ));
        assert!(jobs.lock().contains_key("done"));
    }

    #[test]
    fn clear_recommendation_storage_removes_cloud_snapshots() {
        let conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let items = vec![recommendation_item("netease", "1", "云端歌")];

        save_cloud_recommendation_result(&conn, "home", "job-1", "done", &items).unwrap();
        conn.execute(
            "INSERT INTO library_membership (container_type, container_id, track_key, updated_at) VALUES ('favorite', 'favorites', 'netease:1', 1)",
            [],
        )
        .unwrap();
        assert!(load_latest_cloud_recommendation_job(&conn, "home")
            .unwrap()
            .is_some());

        clear_recommendation_storage(&conn).unwrap();
        assert!(load_latest_cloud_recommendation_job(&conn, "home")
            .unwrap()
            .is_none());
        let membership_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM library_membership", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(membership_count, 0);
    }
}
