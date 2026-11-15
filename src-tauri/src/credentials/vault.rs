use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use super::CredentialKey;

const VERSION: u32 = 1;

// Intentionally no Debug: this struct contains platform cookies and API keys.
#[derive(Clone, Default, Deserialize, Serialize)]
pub(super) struct Vault {
    version: u32,
    revision: u64,
    values: BTreeMap<String, String>,
    resolved: BTreeSet<String>,
}

/// Public key names only, stored as Keychain metadata. Settings can discover
/// whether a key is saved without decrypting its value or prompting the user.
#[derive(Clone, Default, Deserialize, Serialize)]
pub(super) struct Manifest {
    version: u32,
    revision: u64,
    present: BTreeSet<String>,
    resolved: BTreeSet<String>,
}

impl Vault {
    fn empty() -> Self {
        Self {
            version: VERSION,
            ..Self::default()
        }
    }

    fn decode(raw: &str) -> Result<Self, String> {
        let vault: Self = serde_json::from_str(raw)
            .map_err(|_| "已保存的凭据格式异常，请检查账号连接或模型设置".to_string())?;
        if vault.version != VERSION {
            return Err("凭据来自不兼容的版本，请使用较新的 TuneFree".into());
        }
        Ok(vault)
    }

    fn manifest(&self) -> Manifest {
        Manifest {
            version: self.version,
            revision: self.revision,
            present: self
                .values
                .iter()
                .filter(|(_, value)| !value.trim().is_empty())
                .map(|(key, _)| key.clone())
                .collect(),
            resolved: self.resolved.clone(),
        }
    }
}

pub(super) trait Backend {
    type Lock;
    fn lock(&self) -> Result<Self::Lock, String>;
    fn load(&self) -> Result<Option<String>, String>;
    fn manifest(&self) -> Result<Option<Manifest>, String>;
    fn save(&self, raw: &str, manifest: &Manifest) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
    fn load_legacy(&self, key: CredentialKey) -> Result<Option<String>, String>;
    fn contains_legacy(&self, key: CredentialKey) -> Result<bool, String>;
    fn delete_legacy(&self, key: CredentialKey) -> Result<(), String>;
}

#[derive(Clone)]
struct Snapshot {
    value: Vault,
    persisted: Option<Vault>,
}

#[derive(Default)]
struct Cache {
    snapshot: Option<Result<Snapshot, String>>,
    manifest: Option<Result<Option<Manifest>, String>>,
    legacy_presence: BTreeMap<String, bool>,
}

pub(super) struct VaultStore<B> {
    backend: B,
    cache: Mutex<Cache>,
}

impl<B: Backend> VaultStore<B> {
    pub(super) fn new(backend: B) -> Self {
        Self {
            backend,
            cache: Mutex::new(Cache::default()),
        }
    }

    fn snapshot(&self, cache: &mut Cache) -> Result<Snapshot, String> {
        if cache.snapshot.is_none() {
            cache.snapshot = Some(self.backend.load().and_then(|raw| {
                let persisted = raw.as_deref().map(Vault::decode).transpose()?;
                Ok(Snapshot {
                    value: persisted.clone().unwrap_or_else(Vault::empty),
                    persisted,
                })
            }));
        }
        cache.snapshot.as_ref().unwrap().clone()
    }

    fn sync_before_write(&self, cache: &mut Cache) -> Result<Snapshot, String> {
        let snapshot = self.snapshot(cache)?;
        let manifest = self.backend.manifest()?;
        let expected = snapshot.persisted.as_ref().map(|value| value.revision);
        if manifest.as_ref().map(|value| value.revision) != expected {
            // The process cache serves reads, but another running build can
            // write the same vault. Merge its newest data before a mutation.
            cache.snapshot = None;
            return self.snapshot(cache);
        }
        Ok(snapshot)
    }

    fn restore(&self, previous: Option<&Vault>) -> Result<(), String> {
        if let Some(previous) = previous {
            let raw = serde_json::to_string(previous).map_err(|_| "凭据编码失败".to_string())?;
            self.backend.save(&raw, &previous.manifest())?;
            if self.backend.load()?.as_deref() != Some(raw.as_str()) {
                return Err("系统凭据恢复校验失败".into());
            }
        } else {
            self.backend.delete()?;
        }
        Ok(())
    }

    fn persist(&self, previous: &Snapshot, mut next: Vault) -> Result<Snapshot, String> {
        next.revision = previous
            .persisted
            .as_ref()
            .map_or(0, |value| value.revision)
            .checked_add(1)
            .ok_or_else(|| "系统凭据版本已超出范围".to_string())?;
        let raw = serde_json::to_string(&next).map_err(|_| "凭据编码失败".to_string())?;
        // SecItemAdd/Update is atomic. If authorization is denied, no write
        // occurred; do not immediately prompt again to roll back an unchanged
        // item. A successful write still requires a real read-back check.
        self.backend.save(&raw, &next.manifest())?;
        let verified = self.backend.load().and_then(|saved| {
            if saved.as_deref() == Some(raw.as_str()) {
                Ok(())
            } else {
                Err("系统凭据保存校验失败".into())
            }
        });
        if let Err(error) = verified {
            return match self.restore(previous.persisted.as_ref()) {
                Ok(()) => Err(error),
                Err(_) => Err("系统凭据保存与恢复失败，请检查系统权限后重试".into()),
            };
        }
        Ok(Snapshot {
            value: next.clone(),
            persisted: Some(next),
        })
    }

    fn remember(cache: &mut Cache, result: Result<Snapshot, String>) -> Result<Snapshot, String> {
        if let Ok(snapshot) = &result {
            cache.manifest = Some(Ok(snapshot.persisted.as_ref().map(Vault::manifest)));
        }
        cache.snapshot = Some(result.clone());
        result
    }

    pub(super) fn load_many(&self, keys: &[CredentialKey]) -> Result<Vec<Option<String>>, String> {
        let mut cache = self.cache.lock();
        // A cached result (including denial) avoids another Keychain access.
        if let Some(result) = &cache.snapshot {
            let snapshot = result.as_ref().map_err(Clone::clone)?;
            if keys
                .iter()
                .all(|key| snapshot.value.resolved.contains(key.name()))
            {
                return Ok(keys
                    .iter()
                    .map(|key| snapshot.value.values.get(key.name()).cloned())
                    .collect());
            }
        }
        let result = (|| {
            let _lock = self.backend.lock()?;
            let snapshot = self.sync_before_write(&mut cache)?;
            let mut next = snapshot.value.clone();
            let mut imported = false;
            for key in keys {
                if next.resolved.insert(key.name().into()) && self.backend.contains_legacy(*key)? {
                    if let Some(value) = self.backend.load_legacy(*key)? {
                        next.values.insert(key.name().into(), value);
                        imported = true;
                    }
                }
            }
            if imported {
                // Batch imports are verified once. Old encrypted records are
                // retained for the installed older app; resolved markers
                // prevent them from resurrecting a logout in the new app.
                self.persist(&snapshot, next)
            } else {
                Ok(Snapshot {
                    value: next,
                    ..snapshot
                })
            }
        })();
        let snapshot = Self::remember(&mut cache, result)?;
        Ok(keys
            .iter()
            .map(|key| snapshot.value.values.get(key.name()).cloned())
            .collect())
    }

    pub(super) fn save(&self, key: CredentialKey, value: &str) -> Result<(), String> {
        let mut cache = self.cache.lock();
        let result = (|| {
            let _lock = self.backend.lock()?;
            let snapshot = self.sync_before_write(&mut cache)?;
            if snapshot.value.values.get(key.name()).map(String::as_str) == Some(value) {
                return Ok(snapshot);
            }
            let mut next = snapshot.value.clone();
            next.resolved.insert(key.name().into());
            next.values.insert(key.name().into(), value.into());
            self.persist(&snapshot, next)
        })();
        Self::remember(&mut cache, result).map(|_| ())
    }

    pub(super) fn delete(&self, key: CredentialKey) -> Result<(), String> {
        let mut cache = self.cache.lock();
        let result = (|| {
            let _lock = self.backend.lock()?;
            let snapshot = self.sync_before_write(&mut cache)?;
            let mut next = snapshot.value.clone();
            let changed =
                next.resolved.insert(key.name().into()) | next.values.remove(key.name()).is_some();
            let saved = if changed {
                self.persist(&snapshot, next)?
            } else {
                snapshot.clone()
            };
            if let Err(error) = self.backend.delete_legacy(key) {
                self.restore(snapshot.persisted.as_ref())
                    .map_err(|_| "系统凭据删除与恢复失败，请检查系统权限后重试".to_string())?;
                return Err(error);
            }
            Ok(saved)
        })();
        Self::remember(&mut cache, result).map(|_| ())
    }

    pub(super) fn contains(&self, key: CredentialKey) -> Result<bool, String> {
        let mut cache = self.cache.lock();
        if let Some(Ok(snapshot)) = &cache.snapshot {
            if snapshot.value.resolved.contains(key.name()) {
                return Ok(snapshot.value.manifest().present.contains(key.name()));
            }
        }
        if cache.manifest.is_none() {
            cache.manifest = Some(self.backend.manifest());
        }
        if let Some(manifest) = cache
            .manifest
            .as_ref()
            .unwrap()
            .as_ref()
            .map_err(Clone::clone)?
        {
            if manifest.version != VERSION {
                return Err("系统凭据元数据来自不兼容的版本".into());
            }
            if manifest.resolved.contains(key.name()) {
                return Ok(manifest.present.contains(key.name()));
            }
        }
        if let Some(present) = cache.legacy_presence.get(key.name()) {
            return Ok(*present);
        }
        let present = self.backend.contains_legacy(key)?;
        cache.legacy_presence.insert(key.name().into(), present);
        Ok(present)
    }

    pub(super) fn retry_failed_access(&self) {
        let mut cache = self.cache.lock();
        if matches!(cache.snapshot, Some(Err(_))) || matches!(cache.manifest, Some(Err(_))) {
            *cache = Cache::default();
        }
    }
}

#[cfg(test)]
#[path = "__tests__/vault.rs"]
mod tests;
