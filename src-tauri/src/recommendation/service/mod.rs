mod candidates;
mod feedback;
mod jobs;
mod library;
mod storage;

#[cfg(test)]
mod tests;

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
    catalog, db, discovery, events, exclusions, llm, llm_config, migration,
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
            Err(error) => {
                log::error!("推荐数据库不可用，使用内存降级模式: {}", error);
                let conn = Connection::open_in_memory()
                    .map_err(|error| format!("创建内存推荐数据库失败: {}", error))?;
                migration::run_migrations(&conn)
                    .map_err(|error| format!("初始化内存推荐数据库失败: {}", error))?;
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
            let mut conn = self.conn.lock();
            let tx = conn
                .transaction()
                .map_err(|error| format!("开启推荐事件事务失败: {}", error))?;
            let inserted = events::insert_event(&tx, &event)
                .map_err(|error| format!("写入推荐事件失败: {}", error))?;
            if let Some(song) = &event.song {
                profile::update_profile_for_song(&tx, song, weight, event.quality.as_deref())
                    .map_err(|error| format!("更新推荐画像失败: {}", error))?;
            }
            if event_type == "play_start" {
                events::update_session_cooccurrence_for_event(&tx, &inserted)
                    .map_err(|error| format!("更新播放共现失败: {}", error))?;
            }
            tx.commit()
                .map_err(|error| format!("提交推荐事件事务失败: {}", error))?;
        }
        if weight != 0.0 {
            self.invalidate_and_schedule_refresh("用户行为更新");
        }
        Ok(())
    }
}

#[cfg(test)]
use candidates::{is_seed_song, merge_discovery_candidates};
#[cfg(test)]
use feedback::record_recommendation_feedback;
#[cfg(test)]
use jobs::{invalidate_recommendation_state, is_current_generation};
#[cfg(test)]
use library::{apply_library_delta, rebuild_cooccurrence_index, sync_library_snapshot};
#[cfg(test)]
use storage::{
    clear_recommendation_storage, load_latest_cloud_recommendation_job,
    run_recommendation_maintenance_at, save_cloud_recommendation_result,
};
