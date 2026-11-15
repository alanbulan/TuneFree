use super::*;
use crate::credentials::vault::VaultStore;

struct Isolated(Keychain);

impl Isolated {
    fn new() -> Self {
        let mut random = [0_u8; 8];
        getrandom::fill(&mut random).unwrap();
        let id: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        Self(Keychain {
            suffix: format!(".tests-{}-{id}", std::process::id()),
        })
    }

    fn store(&self) -> VaultStore<Keychain> {
        VaultStore::new(Keychain {
            suffix: self.0.suffix.clone(),
        })
    }
}

impl Drop for Isolated {
    fn drop(&mut self) {
        let _ = self.0.delete();
        for key in [
            CredentialKey::Netease,
            CredentialKey::Qq,
            CredentialKey::Kuwo,
            CredentialKey::Llm,
            CredentialKey::LegacyLlm,
        ] {
            let _ = self.0.delete_legacy(key);
        }
        let _ = std::fs::remove_file(self.0.lock_path().unwrap());
    }
}

#[test]
#[ignore = "writes only isolated credentials to macOS Keychain"]
fn native_vault_migration_metadata_cache_and_logout_round_trip() {
    let isolated = Isolated::new();
    for key in [
        CredentialKey::Netease,
        CredentialKey::Qq,
        CredentialKey::Llm,
    ] {
        isolated
            .0
            .entry(key.legacy_service(), key.name())
            .unwrap()
            .set_password(&format!("fixture-{}", key.name()))
            .unwrap();
    }
    let store = isolated.store();
    let keys = [
        CredentialKey::Netease,
        CredentialKey::Qq,
        CredentialKey::Kuwo,
        CredentialKey::Llm,
    ];
    assert!(store.contains(CredentialKey::Llm).unwrap());
    assert!(isolated.0.load().unwrap().is_none());
    let values = store.load_many(&keys).unwrap();
    assert!(
        values[0].is_some() && values[1].is_some() && values[2].is_none() && values[3].is_some()
    );
    assert!(isolated.0.manifest().unwrap().is_some());
    assert_eq!(isolated.store().load_many(&keys).unwrap(), values);
    store
        .save(CredentialKey::Qq, "replacement-session")
        .unwrap();
    assert_eq!(
        isolated.store().load_many(&[CredentialKey::Qq]).unwrap()[0].as_deref(),
        Some("replacement-session")
    );
    store.delete(CredentialKey::Qq).unwrap();
    assert!(isolated.0.load_legacy(CredentialKey::Qq).unwrap().is_none());
    let restarted = isolated.store();
    assert!(!restarted.contains(CredentialKey::Qq).unwrap());
    assert!(restarted.contains(CredentialKey::Llm).unwrap());
    assert!(restarted.load_many(&[CredentialKey::Qq]).unwrap()[0].is_none());
    assert_eq!(
        restarted.load_many(&[CredentialKey::Llm]).unwrap()[0].as_deref(),
        Some("fixture-llm-api-key-v1")
    );
}

#[test]
#[ignore = "writes only isolated credentials to macOS Keychain"]
fn native_metadata_does_not_decrypt_a_malformed_legacy_key_or_migrate_it() {
    let isolated = Isolated::new();
    isolated
        .0
        .entry(
            CredentialKey::Llm.legacy_service(),
            CredentialKey::Llm.name(),
        )
        .unwrap()
        .set_secret(&[0xff, 0xfe, 0xfd])
        .unwrap();
    let store = isolated.store();
    assert!(store.contains(CredentialKey::Llm).unwrap());
    assert!(isolated.0.load().unwrap().is_none());
    assert!(store
        .load_many(&[CredentialKey::Llm])
        .unwrap_err()
        .contains("读取系统凭据失败"));
    assert!(isolated.0.load().unwrap().is_none());
    assert!(isolated.0.contains_legacy(CredentialKey::Llm).unwrap());
}
