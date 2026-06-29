use std::{
    collections::HashMap,
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
        LibrarySnapshot, LlmConfigInput, LlmConfigView, LlmProviderTestResult, RecSong,
        RecommendationEvent, RecommendationFeedback, RecommendationItem, RecommendationJob,
        RecommendationJobStage, RecommendationJobStatus, RecommendationMaintenanceStats,
        RecommendationQuery,
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
        Ok(Self {
            conn: Arc::new(Mutex::new(database.conn)),
            db_path: database.path,
            client: client.clone(),
            provider: OpenAiCompatibleProvider::new(client),
            last_llm_error: Arc::new(Mutex::new(None)),
            recommendation_jobs: Arc::new(Mutex::new(HashMap::new())),
            dynamic_refresh_pending: Arc::new(AtomicBool::new(false)),
            last_dynamic_refresh_at: Arc::new(AtomicI64::new(0)),
        })
    }

    pub fn log_event(&self, event: RecommendationEvent) -> Result<(), String> {
        let event_type = event.event_type.clone();
        {
            let conn = self.conn.lock();
            let weight = events::event_weight(&event.event_type);
            events::insert_event(&conn, &event).map_err(|e| format!("写入推荐事件失败: {}", e))?;
            if let Some(song) = &event.song {
                profile::update_profile_for_song(&conn, song, weight, event.quality.as_deref())
                    .map_err(|e| format!("更新推荐画像失败: {}", e))?;
            }
        }
        if should_trigger_dynamic_refresh(&event_type) {
            self.schedule_dynamic_recommendation_refresh("用户行为更新");
        }
        Ok(())
    }

    pub fn sync_library(&self, snapshot: LibrarySnapshot) -> Result<(), String> {
        {
            let conn = self.conn.lock();
            for song in &snapshot.favorites {
                catalog::upsert_track(&conn, song)
                    .map_err(|e| format!("同步收藏歌曲失败: {}", e))?;
                profile::update_profile_for_song(
                    &conn,
                    song,
                    events::event_weight("favorite_add") * 0.3,
                    None,
                )
                .map_err(|e| format!("同步收藏画像失败: {}", e))?;
            }

            for playlist in &snapshot.playlists {
                for song in &playlist.songs {
                    catalog::upsert_track(&conn, song)
                        .map_err(|e| format!("同步歌单歌曲失败: {}", e))?;
                    profile::update_profile_for_song(
                        &conn,
                        song,
                        events::event_weight("playlist_add") * 0.2,
                        None,
                    )
                    .map_err(|e| format!("同步歌单画像失败: {}", e))?;
                }
                update_playlist_cooccurrence(&conn, &playlist.songs)
                    .map_err(|e| format!("同步歌单共现失败: {}", e))?;
            }

            for song in &snapshot.queue {
                catalog::upsert_track(&conn, song)
                    .map_err(|e| format!("同步播放队列失败: {}", e))?;
            }
            if let Some(song) = &snapshot.current_song {
                catalog::upsert_track(&conn, song)
                    .map_err(|e| format!("同步当前歌曲失败: {}", e))?;
            }
        }

        self.schedule_dynamic_recommendation_refresh("曲库同步");
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

            let merged = merge_discovery_candidates(
                local.clone(),
                discovered,
                &request_id,
                llm_candidate_window,
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
            let conn = self.conn.lock();
            let key = catalog::upsert_track(&conn, &song)
                .map_err(|e| format!("保存不感兴趣歌曲失败: {}", e))?;
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
                song: Some(song),
                position_seconds: None,
                duration_seconds: None,
                quality: None,
                context: Some("recommendation".to_string()),
            };
            events::insert_event(&conn, &event)
                .map_err(|e| format!("写入不感兴趣事件失败: {}", e))?;
        }
        self.schedule_dynamic_recommendation_refresh("不感兴趣反馈");
        Ok(())
    }

    pub fn save_feedback(&self, feedback: RecommendationFeedback) -> Result<(), String> {
        {
            let conn = self.conn.lock();
            conn.execute(
                r#"
                INSERT INTO recommendation_feedback (request_id, track_key, action, recommendation_source, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
                params![
                    feedback.request_id,
                    feedback.track_key,
                    feedback.action,
                    feedback.recommendation_source,
                    catalog::now_ms(),
                ],
            )
            .map_err(|e| format!("保存推荐反馈失败: {}", e))?;
        }
        self.schedule_dynamic_recommendation_refresh("推荐反馈");
        Ok(())
    }

    pub fn rebuild_index(&self) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM item_cooccurrence", [])
            .map_err(|e| format!("清空共现索引失败: {}", e))?;
        rebuild_session_cooccurrence(&conn).map_err(|e| format!("重建播放共现失败: {}", e))?;
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
        llm_config::save_config(&conn, config)
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
        {
            let conn = self.conn.lock();
            conn.execute_batch(
                r#"
                DELETE FROM play_events;
                DELETE FROM user_profile;
                DELETE FROM item_cooccurrence;
                DELETE FROM recommendation_cache;
                DELETE FROM dismissed_recommendations;
                DELETE FROM recommendation_feedback;
                DELETE FROM llm_recommendation_cache;
                DELETE FROM llm_calls;
                "#,
            )
            .map_err(|e| format!("清空推荐数据失败: {}", e))?;
        }
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

    fn schedule_dynamic_recommendation_refresh(&self, reason: &'static str) {
        if !self.is_recommendation_enabled() {
            return;
        }
        if self.dynamic_refresh_pending.swap(true, Ordering::SeqCst) {
            return;
        }

        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut delay_ms = DYNAMIC_REFRESH_DEBOUNCE_MS;
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                service.prune_recommendation_jobs();

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
            service
                .dynamic_refresh_pending
                .store(false, Ordering::SeqCst);
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

fn should_trigger_dynamic_refresh(event_type: &str) -> bool {
    matches!(
        event_type,
        "play_30s"
            | "play_complete"
            | "skip_early"
            | "favorite_add"
            | "favorite_remove"
            | "playlist_add"
            | "download"
            | "llm_recommend_click"
            | "similar_click"
    )
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
    let candidate_window = llm_candidate_window.max(1).min(MERGED_CANDIDATE_LIMIT);
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

    merged
}

fn push_candidate(
    merged: &mut Vec<RecommendationItem>,
    seen_track_keys: &mut std::collections::HashSet<String>,
    seen_identities: &mut std::collections::HashSet<String>,
    item: RecommendationItem,
) {
    let track_key = catalog::track_key(&item.song);
    let identity = format!(
        "{}:{}",
        catalog::normalize_text(&item.song.name),
        catalog::normalize_text(&item.song.artist)
    );
    if !seen_track_keys.insert(track_key) || !seen_identities.insert(identity) {
        return;
    }
    merged.push(item);
}

fn update_playlist_cooccurrence(conn: &Connection, songs: &[RecSong]) -> rusqlite::Result<()> {
    let keys: Vec<String> = songs
        .iter()
        .filter_map(|song| catalog::upsert_track(conn, song).ok())
        .collect();
    if keys.len() < 2 {
        return Ok(());
    }
    let score = 1.0 / ((2 + keys.len()) as f64).ln();
    let now = catalog::now_ms();
    for (index, key) in keys.iter().enumerate() {
        for related in keys.iter().skip(index + 1) {
            insert_cooccurrence(conn, key, related, score, now)?;
            insert_cooccurrence(conn, related, key, score, now)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

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

        let merged = merge_discovery_candidates(local_items, discovered, "req-test", 12);
        let first_window = merged.iter().take(12).collect::<Vec<_>>();
        let discovery_count = first_window
            .iter()
            .filter(|item| item.recommendation_source == "discovery")
            .count();

        assert_eq!(discovery_count, 5);
    }

    #[test]
    fn dynamic_refresh_ignores_play_start_noise() {
        assert!(!should_trigger_dynamic_refresh("play_start"));
        assert!(should_trigger_dynamic_refresh("play_30s"));
        assert!(should_trigger_dynamic_refresh("play_complete"));
        assert!(should_trigger_dynamic_refresh("skip_early"));
        assert!(should_trigger_dynamic_refresh("favorite_add"));
        assert!(should_trigger_dynamic_refresh("llm_recommend_click"));
    }
}

fn insert_cooccurrence(
    conn: &Connection,
    track_key: &str,
    related_track_key: &str,
    score: f64,
    updated_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        r#"
        INSERT INTO item_cooccurrence (track_key, related_track_key, score, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(track_key, related_track_key) DO UPDATE SET
          score = item_cooccurrence.score + excluded.score,
          updated_at = excluded.updated_at
        "#,
        params![track_key, related_track_key, score, updated_at],
    )?;
    Ok(())
}

fn rebuild_session_cooccurrence(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        r#"
        SELECT session_id, track_key
        FROM play_events
        WHERE track_key IS NOT NULL AND weight > 0
        ORDER BY session_id, created_at
        "#,
    )?;
    let mut rows = stmt.query([])?;
    let mut session_tracks: Vec<String> = Vec::new();
    let mut current_session = String::new();

    while let Some(row) = rows.next()? {
        let session_id: String = row.get(0)?;
        let track_key: String = row.get(1)?;
        if current_session.is_empty() {
            current_session = session_id.clone();
        }
        if session_id != current_session {
            update_keys_cooccurrence(conn, &session_tracks)?;
            session_tracks.clear();
            current_session = session_id;
        }
        if !session_tracks.iter().any(|key| key == &track_key) {
            session_tracks.push(track_key);
        }
    }
    update_keys_cooccurrence(conn, &session_tracks)?;
    Ok(())
}

fn update_keys_cooccurrence(conn: &Connection, keys: &[String]) -> rusqlite::Result<()> {
    if keys.len() < 2 {
        return Ok(());
    }
    let score = 1.0 / ((2 + keys.len()) as f64).ln();
    let now = catalog::now_ms();
    for (index, key) in keys.iter().enumerate() {
        for related in keys.iter().skip(index + 1) {
            insert_cooccurrence(conn, key, related, score, now)?;
            insert_cooccurrence(conn, related, key, score, now)?;
        }
    }
    Ok(())
}
