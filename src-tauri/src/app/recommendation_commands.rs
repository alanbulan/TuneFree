use crate::recommendation::{
    LibrarySnapshot, LlmConfigInput, LlmConfigView, LlmProviderTestResult, RecSong,
    RecommendationEvent, RecommendationFeedback, RecommendationItem, RecommendationJob,
    RecommendationMaintenanceStats, RecommendationQuery, RecommendationService,
};
use tauri::State;

pub(crate) async fn run_recommendation_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("推荐后台任务异常: {}", error))?
}

#[tauri::command]
pub(crate) async fn log_recommendation_event(
    state: State<'_, RecommendationService>,
    event: RecommendationEvent,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.log_event(event))
        .await
        .map_err(|e| {
            log::error!("{}", e);
            e
        })
}

#[tauri::command]
pub(crate) async fn sync_recommendation_library(
    state: State<'_, RecommendationService>,
    snapshot: LibrarySnapshot,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.sync_library(snapshot)).await
}

#[tauri::command]
pub(crate) async fn get_home_recommendations(
    state: State<'_, RecommendationService>,
    query: RecommendationQuery,
) -> Result<Vec<RecommendationItem>, String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.home_recommendations(query)).await
}

#[tauri::command]
pub(crate) async fn get_similar_songs(
    state: State<'_, RecommendationService>,
    song: RecSong,
    limit: Option<usize>,
) -> Result<Vec<RecommendationItem>, String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.similar_songs(song, limit)).await
}

#[tauri::command]
pub(crate) async fn start_recommendation_job(
    state: State<'_, RecommendationService>,
    query: RecommendationQuery,
) -> Result<RecommendationJob, String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.start_recommendation_job(query)).await
}

#[tauri::command]
pub(crate) async fn get_recommendation_job(
    state: State<'_, RecommendationService>,
    job_id: String,
) -> Result<Option<RecommendationJob>, String> {
    Ok(state.get_recommendation_job(job_id))
}

#[tauri::command]
pub(crate) async fn get_latest_recommendation_job(
    state: State<'_, RecommendationService>,
) -> Result<Option<RecommendationJob>, String> {
    Ok(state.get_latest_recommendation_job())
}

#[tauri::command]
pub(crate) async fn dismiss_recommendation(
    state: State<'_, RecommendationService>,
    song: RecSong,
    reason: Option<String>,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.dismiss(song, reason)).await
}

#[tauri::command]
pub(crate) async fn save_recommendation_feedback(
    state: State<'_, RecommendationService>,
    feedback: RecommendationFeedback,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.save_feedback(feedback)).await
}

#[tauri::command]
pub(crate) async fn rebuild_recommendation_index(
    state: State<'_, RecommendationService>,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.rebuild_index()).await
}

#[tauri::command]
pub(crate) async fn get_llm_config(
    state: State<'_, RecommendationService>,
) -> Result<LlmConfigView, String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.get_llm_config()).await
}

#[tauri::command]
pub(crate) async fn save_llm_config(
    state: State<'_, RecommendationService>,
    config: LlmConfigInput,
) -> Result<(), String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.save_llm_config(config)).await
}

#[tauri::command]
pub(crate) async fn test_llm_provider(
    state: State<'_, RecommendationService>,
    config: Option<LlmConfigInput>,
) -> Result<LlmProviderTestResult, String> {
    state.test_llm_provider(config).await
}

#[tauri::command]
pub(crate) async fn clear_recommendation_data(
    state: State<'_, RecommendationService>,
) -> Result<RecommendationMaintenanceStats, String> {
    let service = state.inner().clone();
    run_recommendation_blocking(move || service.clear_data()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn recommendation_database_work_runs_on_blocking_pool() {
        let value = run_recommendation_blocking(|| Ok::<_, String>(42))
            .await
            .unwrap();
        assert_eq!(value, 42);
    }
}
