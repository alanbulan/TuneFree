use super::*;
use crate::recommendation::{
    credential_store::test_fixture::Credentials, service::tests::initialized_service,
    RecommendationQuery,
};
use crate::test_support::{app, config_input, LlmServer};
use serde_json::json;
use tauri::Manager;

#[tokio::test]
async fn commands_use_managed_state_and_cover_the_library_feedback_and_configuration_lifecycle() {
    let _credentials = Credentials::new().await;
    let app = app();
    let service = Arc::new(initialized_service(&app));
    app.manage(service.clone());
    let song: RecSong = serde_json::from_value(
        json!({"id":"1","source":"qq","name":"歌曲","artist":"歌手","album":""}),
    )
    .unwrap();
    assert!(sync_recommendation_library(
        app.state(),
        LibrarySnapshot {
            favorites: vec![song.clone()],
            playlists: vec![],
            queue: vec![],
            current_song: None,
            delta: None
        }
    )
    .await
    .unwrap());
    log_recommendation_event(
        app.state(),
        RecommendationEvent {
            event_type: "play_start".into(),
            song: Some(song.clone()),
            session_id: Some("command-test".into()),
            position_seconds: Some(0.0),
            duration_seconds: Some(300.0),
            quality: None,
            context: None,
        },
    )
    .await
    .unwrap();
    let job = service
        .start_recommendation_job(RecommendationQuery {
            limit: Some(5),
            seed: None,
            context: None,
        })
        .unwrap();
    assert_eq!(
        get_recommendation_job(app.state(), job.job_id.clone())
            .await
            .unwrap()
            .unwrap()
            .job_id,
        job.job_id
    );
    assert!(get_latest_recommendation_job(app.state())
        .await
        .unwrap()
        .is_some());
    assert!(get_similar_songs(app.state(), song.clone(), Some(2))
        .await
        .unwrap()
        .is_empty());
    save_recommendation_feedback(
        app.state(),
        RecommendationFeedback {
            request_id: job.job_id,
            song: song.clone(),
            action: "play".into(),
            recommendation_source: "local".into(),
            context: None,
        },
    )
    .await
    .unwrap();
    dismiss_recommendation(app.state(), song, Some("不喜欢".into()))
        .await
        .unwrap();
    rebuild_recommendation_index(app.state()).await.unwrap();
    verify_configuration_commands(&app).await;
}

#[tokio::test]
async fn uninitialized_service_and_panicked_workers_return_structured_errors() {
    let app = app();
    app.manage(Arc::new(RecommendationService::new_deferred(
        app.handle().clone(),
        reqwest::Client::new(),
    )));
    let event = RecommendationEvent {
        event_type: "play_start".into(),
        song: None,
        session_id: None,
        position_seconds: None,
        duration_seconds: None,
        quality: None,
        context: None,
    };
    assert_eq!(
        log_recommendation_event(app.state(), event)
            .await
            .unwrap_err()
            .code,
        crate::app::error::ErrorCode::Busy
    );
    let error = run_recommendation_blocking::<(), _>(|| panic!("test worker failure"))
        .await
        .unwrap_err();
    assert_eq!(error.code, crate::app::error::ErrorCode::Internal);
}

async fn verify_configuration_commands(app: &tauri::App) {
    let server = LlmServer::contents(&[r#"{"ok":true}"#, r#"{"ok":true}"#, r#"{"ok":true}"#]).await;
    save_llm_config(app.state(), config_input(&server.base_url))
        .await
        .unwrap();
    assert!(get_llm_config(app.state()).await.unwrap().has_api_key);
    assert!(test_llm_provider(app.state(), None).await.unwrap().ok);
    assert!(
        test_llm_provider(app.state(), Some(config_input(&server.base_url)))
            .await
            .unwrap()
            .ok
    );
    let mut clear = config_input(&server.base_url);
    clear.clear_api_key = Some(true);
    assert!(
        test_llm_provider(app.state(), Some(clear.clone()))
            .await
            .unwrap()
            .ok
    );
    clear.api_key = None;
    assert!(
        !test_llm_provider(app.state(), Some(clear))
            .await
            .unwrap()
            .ok
    );
    assert_eq!(server.calls.lock().len(), 3);
    let stats = clear_recommendation_data(app.state()).await.unwrap();
    assert_eq!(stats.llm_cache_entries, 0);
    assert!(get_latest_recommendation_job(app.state())
        .await
        .unwrap()
        .is_none());
}
