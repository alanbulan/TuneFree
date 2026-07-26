use rusqlite::{params, Connection};

use super::catalog;

#[cfg(windows)]
const SERVICE: &str = "com.alanbulan.tunefree";
#[cfg(windows)]
const ACCOUNT: &str = "llm-api-key-v1";
#[cfg(windows)]
const LEGACY_SERVICE: &str = "TuneFree";
#[cfg(windows)]
const LEGACY_ACCOUNT: &str = "openai-compatible-api-key";

/// Error surfaced by write operations on the credential store.
///
/// `Unavailable` means the platform has no credential backend at all (only
/// `set` reports it — reads degrade to the plaintext fallback instead), so the
/// caller can map it to `ErrorCode::CredentialUnavailable`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialStoreError {
    Unavailable(String),
    Failure(String),
}

impl std::fmt::Display for CredentialStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable(message) | Self::Failure(message) => formatter.write_str(message),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum CredentialId {
    Current,
    Legacy,
}

trait CredentialStore {
    /// Whether this platform has a real credential backend. When false, reads
    /// fall back to the database plaintext and writes fail fast.
    fn is_available(&self) -> bool {
        true
    }
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
    fn is_available(&self) -> bool {
        false
    }

    fn get(&self, _id: CredentialId) -> Result<Option<String>, String> {
        Ok(None)
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

pub fn save_api_key(conn: &Connection, secret: &str) -> Result<(), CredentialStoreError> {
    save_api_key_with_store(conn, &SystemCredentialStore, secret)
}

pub fn delete_api_key(conn: &Connection) -> Result<(), CredentialStoreError> {
    delete_api_key_with_store(conn, &SystemCredentialStore)
}

fn get_api_key_with_store(
    conn: &Connection,
    store: &impl CredentialStore,
) -> Result<String, String> {
    // 无凭据后端的平台不迁移、不报错：读取直接降级到数据库明文，
    // 让配置视图在 macOS/Linux 构建下依然可用。
    if !store.is_available() {
        if is_explicitly_deleted(conn)? {
            return Ok(String::new());
        }
        return load_legacy_secret(conn);
    }
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
) -> Result<(), CredentialStoreError> {
    if !store.is_available() {
        return Err(CredentialStoreError::Unavailable(
            "当前平台尚未配置系统凭据存储，无法保存模型 API Key".to_string(),
        ));
    }
    save_api_key_available(conn, store, secret).map_err(CredentialStoreError::Failure)
}

fn save_api_key_available(
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
) -> Result<(), CredentialStoreError> {
    // 删除在无后端平台上仍需生效：密钥只可能存在于数据库明文里。
    if !store.is_available() {
        return clear_legacy_secret(conn, true).map_err(CredentialStoreError::Failure);
    }
    delete_api_key_available(conn, store).map_err(CredentialStoreError::Failure)
}

fn delete_api_key_available(conn: &Connection, store: &impl CredentialStore) -> Result<(), String> {
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
#[path = "credential_store_tests.rs"]
mod tests;
