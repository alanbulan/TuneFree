use super::*;

fn config() -> CloudJobConfig {
    CloudJobConfig {
        candidate_window: 80,
        per_request_timeout_ms: 60_000,
        cache_ttl_ms: 86_400_000,
        configured_at: 1_000,
    }
}

fn saved_job(at: i64) -> RecommendationJob {
    let item: RecommendationItem = serde_json::from_value(serde_json::json!({
        "song": {"id":"1", "source":"qq", "name":"歌", "artist":"歌手", "album":""},
        "score":0.8, "reasons":[], "recommendationSource":"hybrid", "requestId":"request"
    }))
    .unwrap();
    let mut job = build_initial_job(false, &[], vec![item]);
    job.result_updated_at = at;
    job
}

fn decision(
    now: i64,
    saved: Option<&RecommendationJob>,
    state: &RefreshState,
) -> CloudRefreshDecision {
    cloud_refresh_decision(CloudRefreshContext {
        now,
        saved,
        config: &config(),
        enabled: true,
        synced: true,
        requested: false,
        state,
    })
}

#[test]
fn a_fresh_whole_pipeline_snapshot_skips_both_model_stages() {
    let saved = saved_job(5_000);
    let state = RefreshState {
        preference_changed_at: 4_000,
        cloud_attempted_at: 5_000,
    };
    let result = decision(20_000, Some(&saved), &state);
    assert!(!result.start);
    assert!(!result.waiting);
    let mut next = saved.clone();
    result.apply_state(&mut next, true);
    assert!(matches!(next.stage, RecommendationJobStage::Cached));
    assert_eq!(
        next.result_updated_at, 5_000,
        "读取和本地计算不得刷新云端结果时间"
    );
}

#[test]
fn expiration_empty_results_configuration_and_explicit_preferences_require_refresh() {
    let state = RefreshState {
        preference_changed_at: 0,
        cloud_attempted_at: 0,
    };
    let saved = saved_job(5_000);
    assert!(decision(5_000 + config().cache_ttl_ms, Some(&saved), &state).start);
    assert!(decision(20_000, None, &state).start);
    let mut empty = saved.clone();
    empty.items.clear();
    assert!(decision(20_000, Some(&empty), &state).start);
    let changed = RefreshState {
        preference_changed_at: 6_000,
        ..state
    };
    assert!(decision(20_000, Some(&saved), &changed).start);
    let mut config = config();
    config.configured_at = 6_000;
    assert!(
        cloud_refresh_decision(CloudRefreshContext {
            now: 20_000,
            saved: Some(&saved),
            config: &config,
            enabled: true,
            synced: true,
            requested: false,
            state: &state
        })
        .start
    );
}

#[test]
fn manual_refresh_respects_cloud_cooldown_and_initial_sync() {
    let saved = saved_job(5_000);
    let state = RefreshState {
        preference_changed_at: 0,
        cloud_attempted_at: 5_000,
    };
    let result = cloud_refresh_decision(CloudRefreshContext {
        now: 20_000,
        saved: Some(&saved),
        config: &config(),
        enabled: true,
        synced: true,
        requested: true,
        state: &state,
    });
    assert!(!result.start);
    assert_eq!(result.next_at, Some(5_000 + CLOUD_REFRESH_MIN_INTERVAL_MS));
    assert!(decision(5_000 + CLOUD_REFRESH_MIN_INTERVAL_MS, None, &state).start);
    let waiting = cloud_refresh_decision(CloudRefreshContext {
        now: 20_000,
        saved: None,
        config: &config(),
        enabled: true,
        synced: false,
        requested: false,
        state: &state,
    });
    assert!(waiting.waiting);
    assert!(waiting.next_at.is_none());
    let disabled = cloud_refresh_decision(CloudRefreshContext {
        now: 20_000,
        saved: None,
        config: &config(),
        enabled: false,
        synced: false,
        requested: true,
        state: &state,
    });
    assert!(!disabled.start && !disabled.waiting);
}

#[test]
fn refresh_state_is_idempotent_persistent_and_cleared_with_user_data() {
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    conn.execute("UPDATE recommendation_refresh_state SET preference_changed_at = 30, cloud_attempted_at = 40", []).unwrap();
    migration::run_migrations(&conn).unwrap();
    let state = load_refresh_state(&conn, 35).unwrap();
    assert_eq!(state.preference_changed_at, 30);
    assert_eq!(state.cloud_attempted_at, 40);
    assert_eq!(
        load_refresh_state(&conn, 50).unwrap().cloud_attempted_at,
        50
    );
    super::super::super::storage::clear_recommendation_storage(&conn).unwrap();
    assert_eq!(
        load_refresh_state(&conn, 0).unwrap().preference_changed_at,
        0
    );
    assert_eq!(load_refresh_state(&conn, 0).unwrap().cloud_attempted_at, 0);
}

#[test]
fn a_preference_change_in_the_completion_millisecond_still_invalidates_the_snapshot() {
    let saved = saved_job(5_000);
    let state = RefreshState {
        preference_changed_at: 5_000,
        cloud_attempted_at: 0,
    };
    assert!(decision(20_000, Some(&saved), &state).start);
}

#[test]
fn unreadable_refresh_metadata_does_not_bypass_cloud_cooldown() {
    let conn = Connection::open_in_memory().unwrap();
    assert!(load_refresh_state(&conn, 0).is_err());
}

#[test]
fn waiting_cancelled_disabled_and_empty_local_jobs_have_distinct_states() {
    let mut job = build_initial_job(false, &[], Vec::new());
    assert!(matches!(job.stage, RecommendationJobStage::LocalOnly));
    assert!(!job.cloud_enabled);
    let state = RefreshState {
        preference_changed_at: 0,
        cloud_attempted_at: 5_000,
    };
    decision(20_000, None, &state).apply_state(&mut job, true);
    assert!(matches!(job.status, RecommendationJobStatus::Waiting));
    assert_eq!(job.next_refresh_at, Some(185_000));
    let disabled = super::super::state::disabled_job();
    assert!(matches!(disabled.status, RecommendationJobStatus::Disabled));
    assert_eq!(disabled.local_updated_at, 0);
    assert_eq!(super::super::state::idle_job().result_updated_at, 0);
}
