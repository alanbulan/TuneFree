use std::sync::Arc;

use crate::app::error::{CommandError, CommandResult};
use crate::recommendation::{
    LibrarySnapshot, LlmConfigInput, LlmConfigView, LlmProviderTestResult, RecSong,
    RecommendationEvent, RecommendationFeedback, RecommendationItem, RecommendationJob,
    RecommendationMaintenanceStats, RecommendationService,
};
use tauri::State;

/// Every recommendation command that touches SQLite must run through this
/// helper: the global connection mutex is held across synchronous SQL, so the
/// work has to live on the blocking pool instead of a tokio worker thread.
pub(crate) async fn run_recommendation_blocking<T, F>(operation: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CommandResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            log::error!("推荐后台任务异常: {}", error);
            CommandError::internal("推荐后台任务异常")
        })?
}

#[tauri::command]
pub(crate) async fn log_recommendation_event(
    state: State<'_, Arc<RecommendationService>>,
    event: RecommendationEvent,
) -> CommandResult<()> {
    let service = Arc::clone(state.inner());
    run_recommendation_blocking(move || service.log_event(event))
        .await
        .inspect_err(|error| log::error!("{}", error))
}

#[tauri::command]
pub(crate) async fn sync_recommendation_library(
    state: State<'_, Arc<RecommendationService>>,
    snapshot: LibrarySnapshot,
) -> CommandResult<()> {
    let service = Arc::clone(state.inner());
    run_recommendation_blocking(move || service.sync_library(snapshot)).await
}

#[tauri::command]
pub(crate) async fn get_similar_songs(
    state: State<'_, Arc<RecommendationService>>,
    song: RecSong,
    limit: Option<usize>,
) -> CommandResult<Vec<RecommendationItem>> {
    let service = Arc::clone(state.inner());
    run_recommendation_blocking(move || service.similar_songs(song, limit)).await
}

#[tauri::command]
pub(crate) async fn get_recommendation_job(
    state: State<'_, Arc<RecommendationService>>,
    job_id: String,
) -> CommandResult<Option<RecommendationJob>> {
    // 纯内存查询，不触碰数据库连接，无需进 blocking 池。
    Ok(state.get_recommendation_job(job_id))
}

#[tauri::command]
pub(crate) async fn get_latest_recommendation_job(
    state: State<'_, Arc<RecommendationService>>,
) -> CommandResult<Option<RecommendationJob>> {
    // 内部会回落到云端快照的 SQL 读取，必须走 blocking 池。
    let service = Arc::clone(state.inner());
    run_recommendation_blocking(move || service.get_latest_recommendation_job()).await
}

#[tauri::command]
pub(crate) async fn dismiss_recommendation(
    state: State<'_, Arc<RecommendationService>>,
    song: RecSong,
    reason: Option<String>,
) -> CommandResult<()> {
    let service = Arc::clone(state.inner());
    run_recommendation_blocking(move || service.dismiss(song, reason)).await
}

#[tauri::command]
pub(crate) async fn save_recommendation_feedback(
    state: State<'_, Arc<RecommendationService>>,
    feedback: RecommendationFeedback,
) -> CommandResult<()> {
    let service = Arc::clone(state.inner());
    run_recommendation_blocking(move || service.save_feedback(feedback)).await
}

#[tauri::command]
pub(crate) async fn rebuild_recommendation_index(
    state: State<'_, Arc<RecommendationService>>,
) -> CommandResult<()> {
    let service = Arc::clone(state.inner());
    run_recommendation_blocking(move || service.rebuild_index()).await
}

#[tauri::command]
pub(crate) async fn get_llm_config(
    state: State<'_, Arc<RecommendationService>>,
) -> CommandResult<LlmConfigView> {
    let service = Arc::clone(state.inner());
    run_recommendation_blocking(move || service.get_llm_config()).await
}

#[tauri::command]
pub(crate) async fn save_llm_config(
    state: State<'_, Arc<RecommendationService>>,
    config: LlmConfigInput,
) -> CommandResult<()> {
    let service = Arc::clone(state.inner());
    run_recommendation_blocking(move || service.save_llm_config(config)).await
}

#[tauri::command]
pub(crate) async fn test_llm_provider(
    state: State<'_, Arc<RecommendationService>>,
    config: Option<LlmConfigInput>,
) -> CommandResult<LlmProviderTestResult> {
    state.test_llm_provider(config).await
}

#[tauri::command]
pub(crate) async fn clear_recommendation_data(
    state: State<'_, Arc<RecommendationService>>,
) -> CommandResult<RecommendationMaintenanceStats> {
    let service = Arc::clone(state.inner());
    run_recommendation_blocking(move || service.clear_data()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn recommendation_database_work_runs_on_blocking_pool() {
        let value = run_recommendation_blocking(|| Ok(42)).await.unwrap();
        assert_eq!(value, 42);
    }
}
