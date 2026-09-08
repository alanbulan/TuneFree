use std::{cell::RefCell, collections::HashMap};

use super::*;
use crate::recommendation::migration;

#[path = "__tests__/credential_rollback.rs"]
mod rollback;

#[cfg(any(windows, target_os = "macos"))]
#[tokio::test]
#[ignore = "writes an isolated credential to the native credential store"]
async fn native_credential_store_round_trip() {
    let _credentials = test_fixture::Credentials::new().await;
    let unique = format!(
        "com.alanbulan.tunefree.integration-test-{}-{}",
        std::process::id(),
        catalog::now_ms()
    );
    let entry = keyring::Entry::new(&unique, "credential-round-trip").unwrap();
    let first = "sk-测试-unicode-1";
    let second = "sk-replaced-2";
    let result = (|| {
        entry.set_password(first)?;
        assert_eq!(
            keyring::Entry::new(&unique, "credential-round-trip")?.get_password()?,
            first
        );
        entry.set_password(second)?;
        assert_eq!(entry.get_password()?, second);
        entry.delete_credential()?;
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
        Ok::<(), keyring::Error>(())
    })();
    let _ = entry.delete_credential();
    result.unwrap();
}

#[derive(Default)]
struct MockStore {
    values: RefCell<HashMap<CredentialId, String>>,
    fail_set: RefCell<bool>,
    current_get_count: RefCell<usize>,
    corrupt_on_current_get: RefCell<Option<usize>>,
    fail_delete: RefCell<Option<CredentialId>>,
}

impl CredentialStore for MockStore {
    fn get(&self, id: CredentialId) -> Result<Option<String>, String> {
        let value = self.values.borrow().get(&id).cloned();
        if id == CredentialId::Current {
            let mut count = self.current_get_count.borrow_mut();
            *count += 1;
            if *self.corrupt_on_current_get.borrow() == Some(*count) && value.is_some() {
                return Ok(Some("corrupted".to_string()));
            }
        }
        Ok(value)
    }

    fn set(&self, id: CredentialId, secret: &str) -> Result<(), String> {
        if *self.fail_set.borrow() {
            return Err("mock set failure".to_string());
        }
        self.values.borrow_mut().insert(id, secret.to_string());
        Ok(())
    }

    fn delete(&self, id: CredentialId) -> Result<(), String> {
        if *self.fail_delete.borrow() == Some(id) {
            return Err("mock delete failure".to_string());
        }
        self.values.borrow_mut().remove(&id);
        Ok(())
    }
}

fn database(secret: &str) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    conn.execute("UPDATE llm_config SET api_key = ?1", [secret])
        .unwrap();
    conn
}

#[test]
fn migrates_plaintext_only_after_verified_write() {
    let conn = database("legacy-secret");
    let store = MockStore::default();
    assert_eq!(
        get_api_key_with_store(&conn, &store).unwrap(),
        "legacy-secret"
    );
    assert_eq!(
        store.get(CredentialId::Current).unwrap().as_deref(),
        Some("legacy-secret")
    );
    assert_eq!(load_legacy_secret(&conn).unwrap(), "");
}

#[test]
fn failed_verification_keeps_plaintext_and_restores_previous_entry() {
    let conn = database("legacy-secret");
    let store = MockStore::default();
    store
        .values
        .borrow_mut()
        .insert(CredentialId::Current, "old".to_string());
    *store.corrupt_on_current_get.borrow_mut() = Some(2);
    assert!(save_api_key_with_store(&conn, &store, "new").is_err());
    *store.corrupt_on_current_get.borrow_mut() = None;
    assert_eq!(
        store.get(CredentialId::Current).unwrap().as_deref(),
        Some("old")
    );
    assert_eq!(load_legacy_secret(&conn).unwrap(), "legacy-secret");
}

#[test]
fn migrates_old_keyring_alias_before_plaintext() {
    let conn = database("plaintext");
    let store = MockStore::default();
    store
        .values
        .borrow_mut()
        .insert(CredentialId::Legacy, "old-alias".to_string());
    assert_eq!(get_api_key_with_store(&conn, &store).unwrap(), "old-alias");
    assert!(store.get(CredentialId::Legacy).unwrap().is_none());
    assert_eq!(load_legacy_secret(&conn).unwrap(), "");
}

#[test]
fn explicit_delete_clears_all_sources_and_prevents_resurrection() {
    let conn = database("plaintext");
    let store = MockStore::default();
    store
        .values
        .borrow_mut()
        .insert(CredentialId::Current, "current".to_string());
    store
        .values
        .borrow_mut()
        .insert(CredentialId::Legacy, "old".to_string());
    delete_api_key_with_store(&conn, &store).unwrap();
    conn.execute("UPDATE llm_config SET api_key = 'stale'", [])
        .unwrap();
    assert_eq!(get_api_key_with_store(&conn, &store).unwrap(), "");
}

struct UnavailableStore;

impl CredentialStore for UnavailableStore {
    fn is_available(&self) -> bool {
        false
    }

    fn get(&self, _id: CredentialId) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _id: CredentialId, _secret: &str) -> Result<(), String> {
        Err("后端不可用".to_string())
    }

    fn delete(&self, _id: CredentialId) -> Result<(), String> {
        Err("后端不可用".to_string())
    }
}

#[test]
fn unavailable_backend_reads_plaintext_without_migration() {
    let conn = database("plaintext-secret");
    assert_eq!(
        get_api_key_with_store(&conn, &UnavailableStore).unwrap(),
        "plaintext-secret"
    );
    // 明文必须原样保留：无后端时不能触发迁移把密钥弄丢。
    assert_eq!(load_legacy_secret(&conn).unwrap(), "plaintext-secret");
}

#[test]
fn unavailable_backend_respects_explicit_deletion() {
    let conn = database("stale");
    conn.execute("UPDATE llm_config SET api_key_deleted = 1", [])
        .unwrap();
    assert_eq!(
        get_api_key_with_store(&conn, &UnavailableStore).unwrap(),
        ""
    );
}

#[test]
fn unavailable_backend_set_reports_credential_unavailable() {
    let conn = database("");
    let error = save_api_key_with_store(&conn, &UnavailableStore, "new-secret").unwrap_err();
    assert!(matches!(error, CredentialStoreError::Unavailable(_)));
}

#[test]
fn unavailable_backend_delete_clears_plaintext() {
    let conn = database("plaintext-secret");
    delete_api_key_with_store(&conn, &UnavailableStore).unwrap();
    assert_eq!(load_legacy_secret(&conn).unwrap(), "");
    assert_eq!(
        get_api_key_with_store(&conn, &UnavailableStore).unwrap(),
        ""
    );
}

#[test]
fn failed_legacy_delete_restores_current_and_preserves_database() {
    let conn = database("plaintext");
    let store = MockStore::default();
    store
        .values
        .borrow_mut()
        .insert(CredentialId::Current, "current".to_string());
    store
        .values
        .borrow_mut()
        .insert(CredentialId::Legacy, "old".to_string());
    *store.fail_delete.borrow_mut() = Some(CredentialId::Legacy);
    assert!(delete_api_key_with_store(&conn, &store).is_err());
    assert_eq!(
        store.get(CredentialId::Current).unwrap().as_deref(),
        Some("current")
    );
    assert_eq!(load_legacy_secret(&conn).unwrap(), "plaintext");
}
