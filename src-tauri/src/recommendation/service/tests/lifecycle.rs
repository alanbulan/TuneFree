use super::*;

#[test]
fn service_defers_database_access_and_runs_local_jobs_after_initialization() {
    let app = crate::test_support::app();
    let service = RecommendationService::new_deferred(app.handle().clone(), reqwest::Client::new());
    assert_eq!(
        service.get_llm_config().unwrap_err().code,
        crate::app::error::ErrorCode::Busy
    );
    assert!(service.get_recommendation_job("missing".into()).is_none());
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    assert!(service
        .db
        .set(DbHandle {
            conn: Arc::new(Mutex::new(conn)),
            path: PathBuf::new()
        })
        .is_ok());
    let item = song("qq", "1", "测试歌曲", "歌手");
    service
        .sync_library(LibrarySnapshot {
            favorites: vec![item.clone()],
            playlists: vec![],
            queue: vec![],
            current_song: None,
            delta: None,
        })
        .unwrap();
    let job = service
        .start_recommendation_job(RecommendationQuery {
            seed: None,
            context: Some("home".into()),
            limit: Some(5),
        })
        .unwrap();
    assert!(matches!(job.status, RecommendationJobStatus::Done));
    assert_eq!(job.items.len(), 1);
    assert_eq!(job.items[0].song.name, "测试歌曲");
    assert_eq!(
        service
            .get_latest_recommendation_job()
            .unwrap()
            .unwrap()
            .job_id,
        job.job_id
    );
    service.rebuild_index().unwrap();
    service.clear_data().unwrap();
    assert!(service.get_recommendation_job(job.job_id).is_none());
}

#[test]
fn service_applies_feedback_and_events_atomically_and_dismisses_across_sources() {
    let app = crate::test_support::app();
    let service = initialized_service(&app);
    let item = song("qq", "1", "歌曲", "歌手");
    let alternate = song("netease", "2", "歌曲", "歌手");
    service
        .sync_library(LibrarySnapshot {
            favorites: vec![item.clone(), alternate.clone()],
            playlists: vec![],
            queue: vec![],
            current_song: None,
            delta: None,
        })
        .unwrap();
    let event = RecommendationEvent {
        event_type: "play_start".into(),
        song: Some(item.clone()),
        session_id: Some("test-session".into()),
        position_seconds: Some(0.0),
        duration_seconds: Some(200.0),
        quality: Some("flac".into()),
        context: Some("home".into()),
    };
    service.log_event(event.clone()).unwrap();
    service
        .log_event(RecommendationEvent {
            song: Some(alternate.clone()),
            ..event.clone()
        })
        .unwrap();
    for event_type in ["play_complete", "favorite_add", "unknown"] {
        service
            .log_event(RecommendationEvent {
                event_type: event_type.into(),
                ..event.clone()
            })
            .unwrap();
    }
    let job = service
        .start_recommendation_job(RecommendationQuery {
            limit: Some(4),
            seed: None,
            context: None,
        })
        .unwrap();
    service
        .save_feedback(RecommendationFeedback {
            request_id: job.job_id.clone(),
            song: item.clone(),
            action: "play".into(),
            recommendation_source: "local".into(),
            context: Some("home".into()),
        })
        .unwrap();
    service
        .dismiss(item.clone(), Some("不喜欢".into()))
        .unwrap();
    assert!(service
        .get_recommendation_job(job.job_id)
        .unwrap()
        .items
        .is_empty());
    assert!(service
        .similar_songs(alternate, Some(5))
        .unwrap()
        .is_empty());
    assert_event_transaction_failures(&service, event);
}

#[test]
fn library_deltas_and_disabled_recommendations_preserve_saved_preferences() {
    let app = crate::test_support::app();
    let service = initialized_service(&app);
    let item = song("qq", "1", "歌曲", "歌手");
    let snapshot = LibrarySnapshot {
        favorites: vec![item.clone()],
        playlists: vec![],
        queue: vec![],
        current_song: None,
        delta: None,
    };
    assert!(service.sync_library(snapshot.clone()).unwrap());
    let generation = service.recommendation_generation.load(Ordering::SeqCst);
    assert!(service.sync_library(snapshot.clone()).unwrap());
    assert_eq!(
        service.recommendation_generation.load(Ordering::SeqCst),
        generation
    );
    let key = catalog::track_key(&item);
    let delta = LibraryDelta {
        upsert_songs: vec![],
        added_memberships: vec![],
        removed_memberships: vec![LibraryMembershipChange {
            container_type: "favorite".into(),
            container_id: "favorites".into(),
            track_key: key,
        }],
    };
    service
        .sync_library(LibrarySnapshot {
            delta: Some(delta),
            ..snapshot.clone()
        })
        .unwrap();
    let conn = service.conn_handle().unwrap();
    let count: i64 = conn
        .lock()
        .query_row("SELECT COUNT(*) FROM library_membership", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
    conn.lock()
        .execute("UPDATE recommendation_settings SET enabled=0", [])
        .unwrap();
    assert!(!service.sync_library(snapshot).unwrap());
    assert!(service
        .start_startup_recommendation_job()
        .unwrap()
        .is_none());
    assert!(service.get_latest_recommendation_job().unwrap().is_none());
}

fn assert_event_transaction_failures(service: &RecommendationService, event: RecommendationEvent) {
    let item = event.song.clone().unwrap();
    let conn = service.conn_handle().unwrap();
    conn.lock().execute_batch("BEGIN").unwrap();
    assert_eq!(
        service.log_event(event.clone()).unwrap_err().code,
        crate::app::error::ErrorCode::Database
    );
    assert!(service
        .dismiss(item.clone(), None)
        .unwrap_err()
        .message
        .contains("事务"));
    assert!(service
        .rebuild_index()
        .unwrap_err()
        .message
        .contains("事务"));
    conn.lock().execute_batch("ROLLBACK; CREATE TRIGGER reject_event BEFORE INSERT ON play_events BEGIN SELECT RAISE(ABORT, 'blocked'); END;").unwrap();
    assert!(service
        .log_event(event)
        .unwrap_err()
        .message
        .contains("写入推荐事件"));
    conn.lock()
        .execute_batch("DROP TRIGGER reject_event")
        .unwrap();
    service.clear_data().unwrap();
}
