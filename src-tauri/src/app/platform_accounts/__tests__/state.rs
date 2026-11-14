use super::*;

#[tokio::test]
async fn invalidation_cancels_late_account_operations_and_expired_sessions_cannot_resolve_playback()
{
    let state = PlatformAccountState::default();
    state.0.initialized.store(true, Ordering::Release);
    let session = netease::parse_account(
        serde_json::json!({"code":200,"profile":{"userId":123,"nickname":"fixture"}}),
        "MUSIC_U=fixture",
    )
    .unwrap();
    state.0.sessions.lock().insert(Platform::Netease, session);
    let (_, revision) = state.session(Platform::Netease).await.unwrap();
    assert_eq!(
        state.playback_cookie("netease").await.as_deref(),
        Some("MUSIC_U=fixture")
    );
    state.invalidate(Platform::Netease);
    assert!(state.check_revision(Platform::Netease, revision).is_err());
    // A rejected old request cannot expire a newly connected session.
    state.expire(Platform::Netease, revision, &model::auth_required());
    assert!(state.playback_cookie("netease").await.is_some());
    state.expire(
        Platform::Netease,
        state.revision(Platform::Netease),
        &model::auth_required(),
    );
    assert!(state.playback_cookie("netease").await.is_none());
    assert!(state.playback_cookie("unsupported").await.is_none());
}

#[test]
fn ipc_account_summary_does_not_serialize_cookie_or_private_identity() {
    let session = netease::parse_account(
        serde_json::json!({"code":200,"profile":{"userId":123,"nickname":"fixture"}}),
        "MUSIC_U=private-cookie-fixture",
    )
    .unwrap();
    let raw = serde_json::to_string(&session.account).unwrap();
    assert!(!raw.contains("cookie"));
    assert!(!raw.contains("private-cookie-fixture"));
}
