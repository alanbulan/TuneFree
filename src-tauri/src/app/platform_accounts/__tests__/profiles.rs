use super::*;
use parking_lot::Mutex;
use std::sync::Arc;

#[derive(Clone, Default)]
struct Store {
    value: Arc<Mutex<Option<String>>>,
    reject: bool,
}

impl CredentialStore for Store {
    fn load(&self, _: Platform) -> CommandResult<Option<String>> {
        Ok(self.value.lock().clone())
    }
    fn save(&self, _: Platform, value: &str) -> CommandResult<()> {
        if self.reject {
            return Err(crate::app::error::CommandError::internal(
                "fixture write rejected",
            ));
        }
        *self.value.lock() = Some(value.into());
        Ok(())
    }
    fn delete(&self, _: Platform) -> CommandResult<()> {
        *self.value.lock() = None;
        Ok(())
    }
}

fn saved_qq() -> Session {
    let mut session = super::super::qq::parse_account(
        serde_json::json!({"info":{"nick":"fixture","encryptUin":"encrypted-id"}}),
        "qqmusic_uin=123; qqmusic_key=test-session",
    )
    .unwrap();
    session.account.state = "saved".into();
    session.account.connected_at = 42;
    session
}

#[test]
fn repairs_only_missing_saved_qq_and_kuwo_portraits_once_per_run() {
    let state = PlatformAccountState::default();
    let qq = saved_qq();
    let mut kuwo = qq.clone();
    kuwo.account.platform = "kuwo".into();
    state.0.sessions.lock().insert(Platform::Qq, qq);
    state.0.sessions.lock().insert(Platform::Kuwo, kuwo);
    state
        .0
        .sessions
        .lock()
        .insert(Platform::Netease, saved_qq());
    let repairs = state.claim_saved_profile_repairs();
    assert_eq!(repairs.len(), 2);
    assert!(state.claim_saved_profile_repairs().is_empty());
    let state = PlatformAccountState::default();
    let mut qq = saved_qq();
    qq.account.avatar_url = Some("https://thirdqq.qlogo.cn/g/current/100".into());
    state.0.sessions.lock().insert(Platform::Qq, qq);
    let mut kuwo = saved_qq();
    kuwo.account.state = "expired".into();
    state.0.sessions.lock().insert(Platform::Kuwo, kuwo);
    assert!(state.claim_saved_profile_repairs().is_empty());
}

#[cfg(any(windows, target_os = "macos"))]
fn replies(avatar: &str) -> serde_json::Value {
    serde_json::json!([
        {"host":"u.y.qq.com","path":"/cgi-bin/musicu.fcg","body":serde_json::json!({"code":0,"req":{"code":0,"data":{"info":{"nick":"fresh name"}}}}).to_string()},
        {"host":"u.y.qq.com","path":"/cgi-bin/musicu.fcg","body":serde_json::json!({"code":0,"req":{"code":0,"data":{"code":0,"map_userinfo":{"123":{"uin":123,"headurl":avatar}}}}}).to_string()}
    ])
}

#[cfg(any(windows, target_os = "macos"))]
fn state_with_client(client: reqwest::Client, previous: Session) -> PlatformAccountState {
    let mut state = PlatformAccountState::default();
    Arc::get_mut(&mut state.0).unwrap().client = client;
    state.0.initialized.store(true, Ordering::Release);
    state.0.sessions.lock().insert(Platform::Qq, previous);
    state
}

#[cfg(any(windows, target_os = "macos"))]
#[tokio::test]
async fn repaired_avatar_is_saved_with_the_same_cookie_and_restored_after_restart() {
    use crate::test_support::https::HttpsServer;
    let server = HttpsServer::start(replies("//thirdqq.qlogo.cn/g/current/100"));
    let previous = saved_qq();
    let state = state_with_client(server.client.clone(), previous.clone());
    let store = Store::default();
    let account = state
        .refresh_profile(Platform::Qq, previous.clone(), 0, store.clone())
        .await
        .unwrap();
    assert_eq!(
        account.avatar_url.as_deref(),
        Some("https://thirdqq.qlogo.cn/g/current/100")
    );
    let restored: Session =
        serde_json::from_str(store.load(Platform::Qq).unwrap().as_deref().unwrap()).unwrap();
    assert_eq!(restored.cookie, previous.cookie);
    assert_eq!(restored.encrypted_user_id, previous.encrypted_user_id);
    assert_eq!(restored.account.connected_at, 42);
    assert_eq!(restored.account.avatar_url, account.avatar_url);
    assert_eq!(
        state
            .session(Platform::Qq)
            .await
            .unwrap()
            .0
            .account
            .nickname,
        "fresh name"
    );
}

#[cfg(any(windows, target_os = "macos"))]
#[tokio::test]
async fn optional_avatar_failure_preserves_the_saved_portrait_and_failed_writes_preserve_state() {
    use crate::test_support::https::HttpsServer;
    let server = HttpsServer::start(replies("undefined"));
    let mut previous = saved_qq();
    previous.account.avatar_url = Some("https://thirdqq.qlogo.cn/g/saved/100".into());
    let state = state_with_client(server.client.clone(), previous.clone());
    let store = Store::default();
    let account = state
        .refresh_profile(Platform::Qq, previous.clone(), 0, store)
        .await
        .unwrap();
    assert_eq!(account.avatar_url, previous.account.avatar_url);
    let server = HttpsServer::start(replies("//thirdqq.qlogo.cn/g/new/100"));
    let state = state_with_client(server.client.clone(), previous.clone());
    let store = Store {
        reject: true,
        ..Store::default()
    };
    assert!(state
        .refresh_profile(Platform::Qq, previous.clone(), 0, store)
        .await
        .is_err());
    assert_eq!(
        state
            .session(Platform::Qq)
            .await
            .unwrap()
            .0
            .account
            .avatar_url,
        previous.account.avatar_url
    );
}

#[cfg(any(windows, target_os = "macos"))]
#[tokio::test]
async fn invalidated_profile_requests_do_not_fetch_or_save_after_logout() {
    use crate::test_support::https::HttpsServer;
    let server = HttpsServer::start(serde_json::json!([]));
    let previous = saved_qq();
    let state = state_with_client(server.client.clone(), previous.clone());
    state.invalidate(Platform::Qq);
    let store = Store::default();
    assert!(state
        .refresh_profile(Platform::Qq, previous, 0, store.clone())
        .await
        .is_err());
    assert!(store.load(Platform::Qq).unwrap().is_none());
    assert!(server.calls().is_empty());
}

#[cfg(any(windows, target_os = "macos"))]
#[tokio::test]
async fn late_profile_responses_cannot_restore_a_login_after_its_revision_changes() {
    use crate::test_support::https::HttpsServer;
    let server = HttpsServer::start(replies("//thirdqq.qlogo.cn/g/current/100"));
    let previous = saved_qq();
    let state = state_with_client(server.client.clone(), previous.clone());
    let store = Store::default();
    let guard = state.0.operations.lock().await;
    let waiting_state = state.clone();
    let waiting_store = store.clone();
    let pending = tokio::spawn(async move {
        waiting_state
            .refresh_profile(Platform::Qq, previous, 0, waiting_store)
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if server.calls().len() == 2 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    state.invalidate(Platform::Qq);
    drop(guard);
    assert_eq!(
        pending.await.unwrap().err().unwrap().code,
        crate::app::error::ErrorCode::Cancelled
    );
    assert!(store.load(Platform::Qq).unwrap().is_none());
    assert!(state
        .session(Platform::Qq)
        .await
        .unwrap()
        .0
        .account
        .avatar_url
        .is_none());
}

#[cfg(any(windows, target_os = "macos"))]
#[tokio::test]
async fn a_failed_older_portrait_lookup_does_not_erase_a_more_recent_repair() {
    use crate::test_support::https::HttpsServer;
    let mut responses = replies("//thirdqq.qlogo.cn/g/current/100")
        .as_array()
        .unwrap()
        .clone();
    responses.extend(replies("undefined").as_array().unwrap().clone());
    let server = HttpsServer::start(serde_json::json!(responses));
    let previous = saved_qq();
    let state = state_with_client(server.client.clone(), previous.clone());
    let store = Store::default();
    state
        .refresh_profile(Platform::Qq, previous.clone(), 0, store.clone())
        .await
        .unwrap();
    let account = state
        .refresh_profile(Platform::Qq, previous, 0, store.clone())
        .await
        .unwrap();
    assert_eq!(
        account.avatar_url.as_deref(),
        Some("https://thirdqq.qlogo.cn/g/current/100")
    );
    let restored: Session =
        serde_json::from_str(store.load(Platform::Qq).unwrap().as_deref().unwrap()).unwrap();
    assert_eq!(restored.account.avatar_url, account.avatar_url);
}
