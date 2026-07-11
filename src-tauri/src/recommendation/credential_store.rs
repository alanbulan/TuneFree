use rusqlite::{params, Connection};

use super::catalog;

const SERVICE: &str = "com.alanbulan.tunefree";
const ACCOUNT: &str = "llm-api-key-v1";
const LEGACY_SERVICE: &str = "TuneFree";
const LEGACY_ACCOUNT: &str = "openai-compatible-api-key";

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum CredentialId {
    Current,
    Legacy,
}

trait CredentialStore {
    fn get(&self, id: CredentialId) -> Result<Option<String>, String>;
    fn set(&self, id: CredentialId, secret: &str) -> Result<(), String>;
    fn delete(&self, id: CredentialId) -> Result<(), String>;
}

struct SystemCredentialStore;

#[cfg(windows)]
impl SystemCredentialStore {
    fn entry(id: CredentialId) -> Result<keyring::Entry, String> {
        let (service, account) = match id {
            CredentialId::Current => (SERVICE, ACCOUNT),
            CredentialId::Legacy => (LEGACY_SERVICE, LEGACY_ACCOUNT),
        };
        keyring::Entry::new(service, account).map_err(|error| format!("打开系统凭据失败: {error}"))
    }
}

#[cfg(windows)]
impl CredentialStore for SystemCredentialStore {
    fn get(&self, id: CredentialId) -> Result<Option<String>, String> {
        match Self::entry(id)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("读取系统凭据失败: {error}")),
        }
    }

    fn set(&self, id: CredentialId, secret: &str) -> Result<(), String> {
        Self::entry(id)?
            .set_password(secret)
            .map_err(|error| format!("保存系统凭据失败: {error}"))
    }

    fn delete(&self, id: CredentialId) -> Result<(), String> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("删除系统凭据失败: {error}")),
        }
    }
}

#[cfg(not(windows))]
impl CredentialStore for SystemCredentialStore {
    fn get(&self, _id: CredentialId) -> Result<Option<String>, String> {
        Err("当前平台尚未配置系统凭据存储，无法读取模型 API Key".to_string())
    }

    fn set(&self, _id: CredentialId, _secret: &str) -> Result<(), String> {
        Err("当前平台尚未配置系统凭据存储，无法保存模型 API Key".to_string())
    }

    fn delete(&self, _id: CredentialId) -> Result<(), String> {
        Err("当前平台尚未配置系统凭据存储，无法删除模型 API Key".to_string())
    }
}

pub fn get_api_key(conn: &Connection) -> Result<String, String> {
    get_api_key_with_store(conn, &SystemCredentialStore)
}

pub fn save_api_key(conn: &Connection, secret: &str) -> Result<(), String> {
    save_api_key_with_store(conn, &SystemCredentialStore, secret)
}

pub fn delete_api_key(conn: &Connection) -> Result<(), String> {
    delete_api_key_with_store(conn, &SystemCredentialStore)
}

fn get_api_key_with_store(
    conn: &Connection,
    store: &impl CredentialStore,
) -> Result<String, String> {
    if let Some(secret) = store.get(CredentialId::Current)? {
        return Ok(secret);
    }
    if is_explicitly_deleted(conn)? {
        return Ok(String::new());
    }
    if let Some(secret) = store.get(CredentialId::Legacy)? {
        migrate_secret(conn, store, &secret, CredentialId::Legacy)?;
        return Ok(secret);
    }
    let secret = load_legacy_secret(conn)?;
    if secret.trim().is_empty() {
        return Ok(String::new());
    }
    migrate_secret(conn, store, &secret, CredentialId::Current)?;
    Ok(secret)
}

fn migrate_secret(
    conn: &Connection,
    store: &impl CredentialStore,
    secret: &str,
    source: CredentialId,
) -> Result<(), String> {
    let previous = store.get(CredentialId::Current)?;
    set_and_verify(store, secret).inspect_err(|_| {
        let _ = restore_entry(store, CredentialId::Current, previous.as_deref());
    })?;
    let cleanup = if source == CredentialId::Legacy {
        store.delete(CredentialId::Legacy)
    } else {
        clear_legacy_secret(conn, false)
    };
    if let Err(error) = cleanup {
        restore_entry(store, CredentialId::Current, previous.as_deref())?;
        return Err(error);
    }
    if source == CredentialId::Legacy {
        clear_legacy_secret(conn, false).inspect_err(|_| {
            let _ = restore_entry(store, CredentialId::Legacy, Some(secret));
            let _ = restore_entry(store, CredentialId::Current, previous.as_deref());
        })?;
    }
    Ok(())
}

fn save_api_key_with_store(
    conn: &Connection,
    store: &impl CredentialStore,
    secret: &str,
) -> Result<(), String> {
    let previous = store.get(CredentialId::Current)?;
    set_and_verify(store, secret).inspect_err(|_| {
        let _ = restore_entry(store, CredentialId::Current, previous.as_deref());
    })?;
    if let Err(error) = clear_legacy_secret(conn, false) {
        restore_entry(store, CredentialId::Current, previous.as_deref())?;
        return Err(error);
    }
    if let Err(error) = store.delete(CredentialId::Legacy) {
        restore_entry(store, CredentialId::Current, previous.as_deref())?;
        return Err(error);
    }
    Ok(())
}

fn delete_api_key_with_store(
    conn: &Connection,
    store: &impl CredentialStore,
) -> Result<(), String> {
    let current = store.get(CredentialId::Current)?;
    let legacy = store.get(CredentialId::Legacy)?;
    store.delete(CredentialId::Current)?;
    if let Err(error) = store.delete(CredentialId::Legacy) {
        restore_entry(store, CredentialId::Current, current.as_deref())?;
        return Err(error);
    }
    if let Err(error) = clear_legacy_secret(conn, true) {
        restore_entry(store, CredentialId::Current, current.as_deref())?;
        restore_entry(store, CredentialId::Legacy, legacy.as_deref())?;
        return Err(error);
    }
    Ok(())
}

fn set_and_verify(store: &impl CredentialStore, secret: &str) -> Result<(), String> {
    store.set(CredentialId::Current, secret)?;
    if store.get(CredentialId::Current)?.as_deref() == Some(secret) {
        Ok(())
    } else {
        Err("API Key 已提交保存，但系统凭据校验失败".to_string())
    }
}

fn restore_entry(
    store: &impl CredentialStore,
    id: CredentialId,
    secret: Option<&str>,
) -> Result<(), String> {
    match secret {
        Some(value) => store.set(id, value),
        None => store.delete(id),
    }
}

fn load_legacy_secret(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT api_key FROM llm_config WHERE id = 1", [], |row| {
        row.get(0)
    })
    .map_err(|error| format!("读取旧版 API Key 失败: {error}"))
}

fn is_explicitly_deleted(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT api_key_deleted FROM llm_config WHERE id = 1",
        [],
        |row| Ok(row.get::<_, i64>(0)? != 0),
    )
    .map_err(|error| format!("读取 API Key 状态失败: {error}"))
}

fn clear_legacy_secret(conn: &Connection, deleted: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE llm_config SET api_key = '', api_key_deleted = ?1, updated_at = ?2 WHERE id = 1",
        params![i64::from(deleted), catalog::now_ms()],
    )
    .map(|_| ())
    .map_err(|error| format!("更新 API Key 迁移状态失败: {error}"))
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, collections::HashMap};

    use super::*;
    use crate::recommendation::migration;

    #[cfg(windows)]
    #[test]
    #[ignore = "writes an isolated credential to Windows Credential Manager"]
    fn windows_credential_manager_round_trip() {
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
            assert_eq!(entry.get_password()?, first);
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
}
