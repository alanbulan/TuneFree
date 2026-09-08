use super::*;
static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(crate) struct Credentials {
    _lock: tokio::sync::MutexGuard<'static, ()>,
}

impl Credentials {
    pub(crate) async fn new() -> Self {
        let guard = Self {
            _lock: LOCK.lock().await,
        };
        guard.clear();
        guard
    }

    pub(crate) fn clear(&self) {
        for id in [CredentialId::Current, CredentialId::Legacy] {
            SystemCredentialStore.delete(id).unwrap();
        }
    }
}

impl Drop for Credentials {
    fn drop(&mut self) {
        self.clear();
    }
}

#[tokio::test]
async fn malformed_system_secret_is_reported_without_preventing_settings_from_loading() {
    let _credentials = Credentials::new().await;
    let conn = Connection::open_in_memory().unwrap();
    crate::recommendation::migration::run_migrations(&conn).unwrap();
    SystemCredentialStore::entry(CredentialId::Current)
        .unwrap()
        .set_secret(&[0xff, 0xfe, 0xfd])
        .unwrap();
    assert!(SystemCredentialStore
        .get(CredentialId::Current)
        .unwrap_err()
        .contains("读取系统凭据失败"));
    let view = crate::recommendation::llm_config::view_config(&conn, 0, None).unwrap();
    assert!(!view.has_api_key);
    assert!(view.local_recommendation_enabled);
}
