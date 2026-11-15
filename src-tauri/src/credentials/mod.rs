//! One macOS Keychain item for application secrets. Nothing here is an IPC
//! result, a log payload, or a plaintext disk cache. Keychain access controls
//! are left to the operating system and the user's authorization.

mod macos;
mod vault;

use std::sync::OnceLock;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CredentialKey {
    Netease,
    Qq,
    Kuwo,
    Llm,
    LegacyLlm,
}

impl CredentialKey {
    fn name(self) -> &'static str {
        match self {
            Self::Netease => "netease-session-v1",
            Self::Qq => "qq-session-v1",
            Self::Kuwo => "kuwo-session-v1",
            Self::Llm => "llm-api-key-v1",
            Self::LegacyLlm => "openai-compatible-api-key",
        }
    }

    fn legacy_service(self) -> &'static str {
        match self {
            Self::Netease | Self::Qq | Self::Kuwo => "com.alanbulan.tunefree.platform-accounts",
            Self::Llm => "com.alanbulan.tunefree",
            Self::LegacyLlm => "TuneFree",
        }
    }
}

fn store() -> &'static vault::VaultStore<macos::Keychain> {
    static STORE: OnceLock<vault::VaultStore<macos::Keychain>> = OnceLock::new();
    STORE.get_or_init(|| vault::VaultStore::new(macos::Keychain::new()))
}

pub(crate) fn load_many(keys: &[CredentialKey]) -> Result<Vec<Option<String>>, String> {
    store().load_many(keys)
}

pub(crate) fn load(key: CredentialKey) -> Result<Option<String>, String> {
    Ok(load_many(&[key])?.pop().flatten())
}

pub(crate) fn save(key: CredentialKey, value: &str) -> Result<(), String> {
    store().save(key, value)
}

pub(crate) fn delete(key: CredentialKey) -> Result<(), String> {
    store().delete(key)
}

pub(crate) fn contains(key: CredentialKey) -> Result<bool, String> {
    store().contains(key)
}

/// A failed authorization is latched for this run, so automatic playback,
/// configuration refreshes and rerenders cannot create a dialog storm.
/// Only an explicit user retry clears it; successful snapshots stay cached.
pub(crate) fn retry_failed_access() {
    store().retry_failed_access();
}

#[cfg(test)]
pub(crate) fn test_raw_snapshot() -> Result<Option<String>, String> {
    use vault::Backend;
    macos::Keychain::new().load()
}
