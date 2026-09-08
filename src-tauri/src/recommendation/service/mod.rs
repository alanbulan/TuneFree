mod candidates;
mod feedback;
mod jobs;
mod library;
mod storage;

#[cfg(test)]
pub(crate) mod tests;

#[cfg(all(test, windows))]
#[path = "__tests__/background.rs"]
mod background_tests;

#[cfg(all(test, windows))]
#[path = "__tests__/event_transactions.rs"]
mod event_transaction_tests;

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
        Arc, OnceLock,
    },
};

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::Emitter;
use tokio::sync::watch;

use super::{
    catalog, db, discovery, events, exclusions, llm, llm_config, migration,
    model::{
        LibraryDelta, LibraryMembershipChange, LibrarySnapshot, LlmConfigInput, LlmConfigView,
        LlmProviderTestResult, RecSong, RecommendationEvent, RecommendationFeedback,
        RecommendationItem, RecommendationJob, RecommendationJobStage, RecommendationJobStatus,
        RecommendationJobUpdatePayload, RecommendationMaintenanceStats, RecommendationQuery,
    },
    profile,
    provider::OpenAiCompatibleProvider,
    rank, recall, rerank,
};
use crate::app::error::{CommandError, CommandResult};
use crate::app::run_recommendation_blocking;

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
/// 契约 §7.9：弱信号累计到该数量才允许触发一次动态刷新。
const WEAK_SIGNAL_REFRESH_THRESHOLD: u64 = 20;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct LibraryMembershipKey {
    container_type: String,
    container_id: String,
    track_key: String,
}

/// Database state published once background initialization finishes.
pub(super) struct DbHandle {
    pub(super) conn: Arc<Mutex<Connection>>,
    pub(super) path: PathBuf,
}

#[derive(Clone)]
pub struct RecommendationService {
    app: tauri::AppHandle,
    client: reqwest::Client,
    provider: OpenAiCompatibleProvider,
    db: Arc<OnceLock<DbHandle>>,
    init_started: Arc<AtomicBool>,
    last_llm_error: Arc<Mutex<Option<String>>>,
    recommendation_jobs: Arc<Mutex<HashMap<String, RecommendationJob>>>,
    dynamic_refresh_pending: Arc<AtomicBool>,
    last_dynamic_refresh_at: Arc<AtomicI64>,
    recommendation_generation: Arc<AtomicU64>,
    weak_signal_count: Arc<AtomicU64>,
    cloud_cancel: Arc<Mutex<watch::Sender<bool>>>,
}

impl RecommendationService {
    /// Cheap constructor: stores handles only, never touches the database, so
    /// it is safe to call on the Tauri setup thread.
    pub fn new_deferred(app: tauri::AppHandle, client: reqwest::Client) -> Self {
        Self {
            app,
            client: client.clone(),
            provider: OpenAiCompatibleProvider::new(client),
            db: Arc::new(OnceLock::new()),
            init_started: Arc::new(AtomicBool::new(false)),
            last_llm_error: Arc::new(Mutex::new(None)),
            recommendation_jobs: Arc::new(Mutex::new(HashMap::new())),
            dynamic_refresh_pending: Arc::new(AtomicBool::new(false)),
            last_dynamic_refresh_at: Arc::new(AtomicI64::new(0)),
            recommendation_generation: Arc::new(AtomicU64::new(1)),
            weak_signal_count: Arc::new(AtomicU64::new(0)),
            cloud_cancel: Arc::new(Mutex::new(watch::channel(false).0)),
        }
    }

    /// Opens the database, runs migrations, executes deferred rebuilds and
    /// starts the warmup job — all off the setup thread. Idempotent.
    pub fn initialize_in_background(self: &Arc<Self>) {
        if self.init_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let app = service.app.clone();
            let opened =
                tauri::async_runtime::spawn_blocking(move || open_database_with_fallback(&app))
                    .await;
            let database = match opened {
                Ok(Some(database)) => database,
                Ok(None) => return,
                Err(error) => {
                    log::error!("推荐数据库初始化任务异常: {}", error);
                    return;
                }
            };
            let handle = DbHandle {
                conn: Arc::new(Mutex::new(database.conn)),
                path: database.path,
            };
            if service.db.set(handle).is_err() {
                return;
            }
            service.schedule_maintenance();
            service.run_pending_rebuilds_in_background().await;
            let warmup = (*service).clone();
            match tauri::async_runtime::spawn_blocking(move || {
                warmup.start_startup_recommendation_job()
            })
            .await
            {
                Ok(Err(error)) => log::error!("启动智能推荐预热失败: {}", error),
                Err(error) => log::error!("推荐预热任务异常: {}", error),
                Ok(Ok(_)) => {}
            }
            let _ = service.app.emit("recommendation-ready", ());
        });
    }

    /// 迁移标记的画像/共现重建：初始化完成后在独立连接上执行，
    /// 不占用全局连接锁，也不阻塞服务就绪。
    async fn run_pending_rebuilds_in_background(&self) {
        let Some(handle) = self.db.get() else {
            return;
        };
        let path = handle.path.clone();
        let conn = Arc::clone(&handle.conn);
        let result = tauri::async_runtime::spawn_blocking(move || {
            if path.as_os_str().is_empty() {
                return migration::run_pending_rebuilds(&conn.lock());
            }
            match db::open_maintenance_connection(&path) {
                Ok(rebuild_conn) => migration::run_pending_rebuilds(&rebuild_conn),
                Err(error) => {
                    log::warn!("打开重建连接失败，退回全局连接: {}", error);
                    migration::run_pending_rebuilds(&conn.lock())
                }
            }
        })
        .await;
        match result {
            Ok(Ok(true)) => log::info!("迁移遗留的推荐画像重建已在后台完成"),
            Ok(Ok(false)) => {}
            Ok(Err(error)) => log::error!("后台重建推荐画像失败: {}", error),
            Err(error) => log::error!("后台重建推荐画像任务异常: {}", error),
        }
    }

    pub(super) fn db_handle(&self) -> Result<&DbHandle, CommandError> {
        require_db(&self.db)
    }

    pub(super) fn conn_handle(&self) -> Result<Arc<Mutex<Connection>>, CommandError> {
        Ok(Arc::clone(&self.db_handle()?.conn))
    }

    pub(super) fn app_handle(&self) -> &tauri::AppHandle {
        &self.app
    }

    pub fn log_event(&self, event: RecommendationEvent) -> CommandResult<()> {
        let conn = self.conn_handle()?;
        let event_type = event.event_type.clone();
        let weight = events::event_weight(&event.event_type);
        {
            let mut conn = conn.lock();
            let tx = conn.transaction().map_err(|error| {
                CommandError::database(format!("开启推荐事件事务失败: {}", error))
            })?;
            let inserted = events::insert_event(&tx, &event)
                .map_err(|error| CommandError::database(format!("写入推荐事件失败: {}", error)))?;
            if let Some(song) = &event.song {
                profile::update_profile_for_song(&tx, song, weight, event.quality.as_deref())
                    .map_err(|error| {
                        CommandError::database(format!("更新推荐画像失败: {}", error))
                    })?;
            }
            if event_type == "play_start" {
                events::update_session_cooccurrence_for_event(&tx, &inserted).map_err(|error| {
                    CommandError::database(format!("更新播放共现失败: {}", error))
                })?;
            }
            tx.commit().map_err(|error| {
                CommandError::database(format!("提交推荐事件事务失败: {}", error))
            })?;
        }
        self.handle_event_signal(&event_type, weight);
        Ok(())
    }

    /// 契约 §7.9：强信号立即作废在途任务；弱信号只累计，
    /// 达到阈值或距上次刷新足够久时才触发一次不作废在途任务的刷新。
    fn handle_event_signal(&self, event_type: &str, weight: f64) {
        if weight == 0.0 {
            return;
        }
        if is_strong_signal(event_type) {
            self.invalidate_and_schedule_refresh("用户行为更新");
            return;
        }
        let weak_count = self.weak_signal_count.fetch_add(1, Ordering::SeqCst) + 1;
        let elapsed =
            catalog::now_ms().saturating_sub(self.last_dynamic_refresh_at.load(Ordering::SeqCst));
        if should_refresh_for_weak_signals(weak_count, elapsed) {
            self.weak_signal_count.store(0, Ordering::SeqCst);
            self.schedule_dynamic_recommendation_refresh("弱信号累计");
        }
    }

    #[cfg(test)]
    pub(super) fn cancel_inflight_cloud_job(&self) {
        let _ = self.cloud_cancel.lock().send(true);
    }
}

/// Gate shared by every method that needs the database: before background
/// initialization publishes the handle, callers get `Busy` instead of blocking.
pub(super) fn require_db(db: &OnceLock<DbHandle>) -> Result<&DbHandle, CommandError> {
    db.get()
        .ok_or_else(|| CommandError::busy("推荐服务正在初始化，请稍候"))
}

/// 契约 §7.9 的强信号集合：明确的偏好表达才值得作废在途云任务。
pub(super) fn is_strong_signal(event_type: &str) -> bool {
    matches!(
        event_type,
        "favorite_add" | "favorite_remove" | "playlist_add" | "dismiss" | "skip_early"
    )
}

pub(super) fn should_refresh_for_weak_signals(
    weak_count: u64,
    elapsed_since_refresh_ms: i64,
) -> bool {
    weak_count >= WEAK_SIGNAL_REFRESH_THRESHOLD
        || elapsed_since_refresh_ms >= DYNAMIC_REFRESH_MIN_INTERVAL_MS
}

fn open_database_with_fallback(app: &tauri::AppHandle) -> Option<db::RecommendationDatabase> {
    match db::open_database(app) {
        Ok(database) => Some(database),
        Err(error) => {
            log::error!("推荐数据库不可用，使用内存降级模式: {}", error);
            let conn = Connection::open_in_memory()
                .map_err(|error| log::error!("创建内存推荐数据库失败: {}", error))
                .ok()?;
            migration::run_migrations(&conn)
                .map_err(|error| log::error!("初始化内存推荐数据库失败: {}", error))
                .ok()?;
            Some(db::RecommendationDatabase {
                conn,
                path: PathBuf::new(),
            })
        }
    }
}

#[cfg(test)]
use candidates::{is_seed_song, merge_discovery_candidates};
#[cfg(test)]
use feedback::record_recommendation_feedback;
#[cfg(test)]
use jobs::cloud::{cloud_job_timeout_ms, with_cancellation};
#[cfg(test)]
use jobs::{invalidate_recommendation_state, is_current_generation};
#[cfg(test)]
use library::{apply_library_delta, rebuild_cooccurrence_index, sync_library_snapshot};
#[cfg(test)]
use storage::{
    clear_recommendation_storage, load_latest_cloud_recommendation_job,
    run_recommendation_maintenance_at, save_cloud_recommendation_result,
};
