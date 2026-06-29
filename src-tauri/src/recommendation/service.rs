use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use parking_lot::Mutex;
use rusqlite::{params, Connection};

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

const RECOMMENDATION_JOB_TTL_MS: i64 = 10 * 60 * 1000;
const DISCOVERY_QUERY_LIMIT: usize = 6;
const DISCOVERY_RESULTS_PER_SOURCE: usize = 4;
const DISCOVERY_CANDIDATE_LIMIT: usize = 48;
const LOCAL_HEAD_CANDIDATE_LIMIT: usize = 20;
const MERGED_CANDIDATE_LIMIT: usize = 100;

pub struct RecommendationService {
    conn: Arc<Mutex<Connection>>,
    db_path: PathBuf,
    client: reqwest::Client,
    provider: OpenAiCompatibleProvider,
    last_llm_error: Arc<Mutex<Option<String>>>,
    recommendation_jobs: Arc<Mutex<HashMap<String, RecommendationJob>>>,
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
        })
    }

    pub fn log_event(&self, event: RecommendationEvent) -> Result<(), String> {
        let conn = self.conn.lock();
        let weight = events::event_weight(&event.event_type);
        events::insert_event(&conn, &event).map_err(|e| format!("写入推荐事件失败: {}", e))?;
        if let Some(song) = &event.song {
            profile::update_profile_for_song(&conn, song, weight, event.quality.as_deref())
                .map_err(|e| format!("更新推荐画像失败: {}", e))?;
        }
        Ok(())
    }

    pub fn sync_library(&self, snapshot: LibrarySnapshot) -> Result<(), String> {
        let conn = self.conn.lock();
        for song in &snapshot.favorites {
            catalog::upsert_track(&conn, song).map_err(|e| format!("同步收藏歌曲失败: {}", e))?;
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
            catalog::upsert_track(&conn, song).map_err(|e| format!("同步播放队列失败: {}", e))?;
        }
        if let Some(song) = &snapshot.current_song {
            catalog::upsert_track(&conn, song).map_err(|e| format!("同步当前歌曲失败: {}", e))?;
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
            detail: if can_use_cloud && local.is_empty() {
                "本地候选为空，云端正在生成发现方向".to_string()
            } else if can_use_cloud {
                "本地候选已返回，云端正在生成发现方向".to_string()
            } else if local.is_empty() {
                "本地候选为空，云端发现与重排未启用".to_string()
            } else {
                "云端发现与重排未启用，已返回本地推荐".to_string()
            },
            items: local.clone(),
            error: None,
            updated_at: catalog::now_ms(),
        };

        self.recommendation_jobs
            .lock()
            .insert(job_id.clone(), job.clone());
        if !can_use_cloud {
            return Ok(job);
        }

        let conn = Arc::clone(&self.conn);
        let provider = self.provider.clone();
        let client = self.client.clone();
        let jobs = Arc::clone(&self.recommendation_jobs);
        let last_llm_error = Arc::clone(&self.last_llm_error);
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

            let merged = merge_discovery_candidates(local.clone(), discovered, &request_id);
            if merged.is_empty() {
                let error =
                    plan_error.unwrap_or_else(|| "平台搜索未找到可验证的新歌候选".to_string());
                *last_llm_error.lock() = Some(error.clone());
                update_recommendation_job(
                    &jobs,
                    &job_id,
                    RecommendationJobStatus::Error,
                    RecommendationJobStage::Error,
                    "没有可用于重排的真实候选",
                    Some(Vec::new()),
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
                update_recommendation_job(
                    &jobs,
                    &job_id,
                    RecommendationJobStatus::Error,
                    RecommendationJobStage::Error,
                    "云端重排失败，保留已验证候选",
                    Some(result.items),
                    Some(error),
                );
                return;
            }

            update_recommendation_job(
                &jobs,
                &job_id,
                RecommendationJobStatus::Done,
                RecommendationJobStage::Done,
                "已完成本地召回、新歌发现和云端重排",
                Some(result.items),
                None,
            );
        });

        Ok(job)
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
        events::insert_event(&conn, &event).map_err(|e| format!("写入不感兴趣事件失败: {}", e))?;
        Ok(())
    }

    pub fn save_feedback(&self, feedback: RecommendationFeedback) -> Result<(), String> {
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
) -> Vec<RecommendationItem> {
    let mut merged = Vec::new();
    let mut seen_track_keys = std::collections::HashSet::new();
    let mut seen_identities = std::collections::HashSet::new();

    for item in local_items.iter().take(LOCAL_HEAD_CANDIDATE_LIMIT) {
        push_candidate(
            &mut merged,
            &mut seen_track_keys,
            &mut seen_identities,
            item.clone(),
        );
    }

    for item in discovered {
        let reason = discovery::discovery_reason(&item.reason);
        let candidate = RecommendationItem {
            song: item.song,
            score: 0.45,
            reasons: vec![reason, "平台搜索验证".to_string()],
            recommendation_source: "discovery".to_string(),
            request_id: request_id.to_string(),
        };
        push_candidate(
            &mut merged,
            &mut seen_track_keys,
            &mut seen_identities,
            candidate,
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
