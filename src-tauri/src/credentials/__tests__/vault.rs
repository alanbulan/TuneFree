use super::*;
use std::sync::Arc;

#[derive(Default)]
struct State {
    raw: Option<String>,
    manifest: Option<Manifest>,
    legacy: BTreeMap<String, String>,
    reads: usize,
    writes: usize,
    legacy_reads: usize,
    metadata_reads: usize,
    denied: bool,
    deny_write: bool,
    deny_legacy: bool,
    corrupt_next_read: bool,
    corrupt_write: bool,
    fail_legacy_delete: bool,
}

#[derive(Clone, Default)]
struct Memory(Arc<Mutex<State>>);

impl Backend for Memory {
    type Lock = ();
    fn lock(&self) -> Result<(), String> {
        Ok(())
    }
    fn load(&self) -> Result<Option<String>, String> {
        let mut state = self.0.lock();
        state.reads += 1;
        if state.denied {
            return Err("fixture access denied".into());
        }
        if std::mem::take(&mut state.corrupt_next_read) {
            return Ok(Some("corrupt".into()));
        }
        Ok(state.raw.clone())
    }
    fn manifest(&self) -> Result<Option<Manifest>, String> {
        let mut state = self.0.lock();
        state.metadata_reads += 1;
        Ok(state.manifest.clone())
    }
    fn save(&self, raw: &str, manifest: &Manifest) -> Result<(), String> {
        let mut state = self.0.lock();
        state.writes += 1;
        if state.deny_write {
            return Err("fixture write denied".into());
        }
        state.raw = Some(raw.into());
        state.manifest = Some(manifest.clone());
        if std::mem::take(&mut state.corrupt_write) {
            state.corrupt_next_read = true;
        }
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        let mut state = self.0.lock();
        state.raw = None;
        state.manifest = None;
        Ok(())
    }
    fn load_legacy(&self, key: CredentialKey) -> Result<Option<String>, String> {
        let mut state = self.0.lock();
        state.legacy_reads += 1;
        if state.deny_legacy {
            return Err("fixture legacy denied".into());
        }
        Ok(state.legacy.get(key.name()).cloned())
    }
    fn contains_legacy(&self, key: CredentialKey) -> Result<bool, String> {
        let mut state = self.0.lock();
        state.metadata_reads += 1;
        Ok(state.legacy.contains_key(key.name()))
    }
    fn delete_legacy(&self, key: CredentialKey) -> Result<(), String> {
        let mut state = self.0.lock();
        if state.fail_legacy_delete {
            return Err("fixture cleanup denied".into());
        }
        state.legacy.remove(key.name());
        Ok(())
    }
}

fn load(store: &VaultStore<Memory>, key: CredentialKey) -> Option<String> {
    store.load_many(&[key]).unwrap().pop().flatten()
}

fn seed(backend: &Memory, keys: &[CredentialKey]) {
    let mut state = backend.0.lock();
    let mut value = Vault::empty();
    value.revision = 1;
    for key in keys {
        value
            .values
            .insert(key.name().into(), format!("fixture-{}", key.name()));
        value.resolved.insert(key.name().into());
    }
    state.raw = Some(serde_json::to_string(&value).unwrap());
    state.manifest = Some(value.manifest());
}

#[test]
fn batch_migration_verifies_once_preserves_old_records_and_restarts_with_one_secret_read() {
    let backend = Memory::default();
    for key in [CredentialKey::Netease, CredentialKey::Qq] {
        backend
            .0
            .lock()
            .legacy
            .insert(key.name().into(), format!("fixture-{}", key.name()));
    }
    let keys = [
        CredentialKey::Netease,
        CredentialKey::Qq,
        CredentialKey::Kuwo,
    ];
    let store = VaultStore::new(backend.clone());
    let first = store.load_many(&keys).unwrap();
    assert!(first[0].is_some() && first[1].is_some() && first[2].is_none());
    assert_eq!(backend.0.lock().writes, 1);
    assert_eq!(backend.0.lock().legacy_reads, 2);
    assert_eq!(backend.0.lock().legacy.len(), 2);
    let reads = backend.0.lock().reads;
    assert_eq!(store.load_many(&keys).unwrap(), first);
    assert_eq!(backend.0.lock().reads, reads);
    let restarted = VaultStore::new(backend.clone());
    assert_eq!(restarted.load_many(&keys).unwrap(), first);
    assert_eq!(backend.0.lock().reads, reads + 1);
    assert_eq!(backend.0.lock().legacy_reads, 2);
    assert_eq!(backend.0.lock().writes, 1);
}

#[test]
fn metadata_discovers_current_and_legacy_keys_without_decrypting_or_migrating() {
    let backend = Memory::default();
    seed(&backend, &[CredentialKey::Llm]);
    backend.0.lock().denied = true;
    backend
        .0
        .lock()
        .legacy
        .insert(CredentialKey::Qq.name().into(), "old-fixture".into());
    let store = VaultStore::new(backend.clone());
    assert!(store.contains(CredentialKey::Llm).unwrap());
    assert!(store.contains(CredentialKey::Qq).unwrap());
    assert!(!store.contains(CredentialKey::Kuwo).unwrap());
    assert!(store.contains(CredentialKey::Qq).unwrap());
    assert_eq!(backend.0.lock().reads, 0);
    assert_eq!(backend.0.lock().legacy_reads, 0);
    assert_eq!(backend.0.lock().writes, 0);
    assert!(store.load_many(&[CredentialKey::Llm]).is_err());
    assert!(store.contains(CredentialKey::Llm).unwrap());
    assert!(store.contains(CredentialKey::Qq).unwrap());
    assert_eq!(backend.0.lock().reads, 1);
}

#[test]
fn denial_is_latched_until_an_explicit_retry_and_no_partial_migration_is_saved() {
    let backend = Memory::default();
    backend.0.lock().denied = true;
    let store = VaultStore::new(backend.clone());
    for _ in 0..4 {
        assert!(store.load_many(&[CredentialKey::Qq]).is_err());
    }
    assert_eq!(backend.0.lock().reads, 1);
    backend.0.lock().denied = false;
    assert!(store.save(CredentialKey::Llm, "fixture").is_err());
    assert_eq!(backend.0.lock().reads, 1);
    store.retry_failed_access();
    assert!(store.load_many(&[CredentialKey::Qq]).is_ok());
    assert_eq!(backend.0.lock().reads, 2);
    backend
        .0
        .lock()
        .legacy
        .insert(CredentialKey::Netease.name().into(), "old".into());
    backend.0.lock().deny_legacy = true;
    assert!(store.load_many(&[CredentialKey::Netease]).is_err());
    assert!(store.load_many(&[CredentialKey::Netease]).is_err());
    assert_eq!(backend.0.lock().legacy_reads, 1);
    assert_eq!(backend.0.lock().writes, 0);
    assert!(backend.0.lock().raw.is_none());
}

#[test]
fn writes_and_readback_failures_preserve_the_previous_vault() {
    for existing in [false, true] {
        let backend = Memory::default();
        if existing {
            seed(&backend, &[CredentialKey::Qq, CredentialKey::Llm]);
        }
        let previous = backend.0.lock().raw.clone();
        backend.0.lock().corrupt_write = true;
        let store = VaultStore::new(backend.clone());
        assert!(store.save(CredentialKey::Llm, "replacement").is_err());
        assert_eq!(backend.0.lock().raw, previous);
        store.retry_failed_access();
        assert_eq!(load(&store, CredentialKey::Llm).is_some(), existing);
        backend.0.lock().deny_write = true;
        assert!(store.save(CredentialKey::Llm, "denied").is_err());
        assert_eq!(backend.0.lock().raw, previous);
        let writes = backend.0.lock().writes;
        assert!(store.save(CredentialKey::Qq, "denied-again").is_err());
        assert_eq!(backend.0.lock().writes, writes);
    }
}

#[test]
fn deleted_legacy_credentials_cannot_resurrect_and_other_accounts_are_retained() {
    let backend = Memory::default();
    seed(&backend, &[CredentialKey::Qq, CredentialKey::Llm]);
    backend
        .0
        .lock()
        .legacy
        .insert(CredentialKey::Qq.name().into(), "old".into());
    let store = VaultStore::new(backend.clone());
    store.delete(CredentialKey::Qq).unwrap();
    assert!(!backend
        .0
        .lock()
        .legacy
        .contains_key(CredentialKey::Qq.name()));
    // Simulate a leftover older build writing a stale record again.
    backend
        .0
        .lock()
        .legacy
        .insert(CredentialKey::Qq.name().into(), "stale".into());
    let restarted = VaultStore::new(backend.clone());
    assert!(load(&restarted, CredentialKey::Qq).is_none());
    assert!(!restarted.contains(CredentialKey::Qq).unwrap());
    assert!(load(&restarted, CredentialKey::Llm).is_some());
    assert_eq!(backend.0.lock().legacy_reads, 0);
}

#[test]
fn failed_legacy_cleanup_restores_the_original_aggregate() {
    let backend = Memory::default();
    seed(&backend, &[CredentialKey::Qq, CredentialKey::Llm]);
    let previous = backend.0.lock().raw.clone();
    backend.0.lock().fail_legacy_delete = true;
    let store = VaultStore::new(backend.clone());
    assert!(store.delete(CredentialKey::Qq).is_err());
    assert_eq!(backend.0.lock().raw, previous);
}

#[test]
fn separate_process_snapshots_merge_the_latest_generation_before_mutating() {
    let backend = Memory::default();
    seed(&backend, &[CredentialKey::Qq]);
    let first = VaultStore::new(backend.clone());
    let second = VaultStore::new(backend.clone());
    assert!(load(&first, CredentialKey::Qq).is_some());
    assert!(load(&second, CredentialKey::Qq).is_some());
    first.save(CredentialKey::Llm, "new-model-key").unwrap();
    second.save(CredentialKey::Netease, "new-session").unwrap();
    first.delete(CredentialKey::Qq).unwrap();
    let restarted = VaultStore::new(backend.clone());
    assert_eq!(
        load(&restarted, CredentialKey::Llm).as_deref(),
        Some("new-model-key")
    );
    assert_eq!(
        load(&restarted, CredentialKey::Netease).as_deref(),
        Some("new-session")
    );
    assert!(load(&restarted, CredentialKey::Qq).is_none());
}

#[test]
fn unchanged_credentials_do_not_write_and_successful_retries_keep_the_cached_snapshot() {
    let backend = Memory::default();
    seed(&backend, &[CredentialKey::Qq]);
    let store = VaultStore::new(backend.clone());
    let original = load(&store, CredentialKey::Qq).unwrap();
    store.save(CredentialKey::Qq, &original).unwrap();
    store.retry_failed_access();
    assert_eq!(
        load(&store, CredentialKey::Qq).as_deref(),
        Some(original.as_str())
    );
    assert_eq!(backend.0.lock().reads, 1);
    assert_eq!(backend.0.lock().writes, 0);
}

#[test]
fn malformed_or_future_vaults_are_reported_without_being_overwritten() {
    for raw in [
        "not-json",
        "{\"version\":99,\"revision\":1,\"values\":{},\"resolved\":[]}",
    ] {
        let backend = Memory::default();
        backend.0.lock().raw = Some(raw.into());
        let store = VaultStore::new(backend.clone());
        assert!(store.load_many(&[CredentialKey::Qq]).is_err());
        assert!(store.save(CredentialKey::Qq, "replacement").is_err());
        assert_eq!(backend.0.lock().reads, 1);
        assert_eq!(backend.0.lock().writes, 0);
        assert_eq!(backend.0.lock().raw.as_deref(), Some(raw));
    }
}

#[test]
fn concurrent_platform_and_model_requests_share_the_same_initial_read() {
    let backend = Memory::default();
    seed(
        &backend,
        &[
            CredentialKey::Netease,
            CredentialKey::Qq,
            CredentialKey::Llm,
        ],
    );
    let store = Arc::new(VaultStore::new(backend.clone()));
    let workers: Vec<_> = [
        CredentialKey::Netease,
        CredentialKey::Qq,
        CredentialKey::Llm,
    ]
    .into_iter()
    .map(|key| {
        let store = store.clone();
        std::thread::spawn(move || store.load_many(&[key]).unwrap())
    })
    .collect();
    for worker in workers {
        assert!(worker.join().unwrap()[0].is_some());
    }
    assert_eq!(backend.0.lock().reads, 1);
}
