use super::*;

fn reject_database_update(conn: &Connection) {
    conn.execute_batch(
        "CREATE TRIGGER reject_key_update BEFORE UPDATE ON llm_config
         BEGIN SELECT RAISE(ABORT, 'database unavailable'); END;",
    )
    .unwrap();
}

fn secret(store: &MockStore, id: CredentialId) -> Option<String> {
    store.values.borrow().get(&id).cloned()
}

#[test]
fn failed_migration_keeps_the_original_secret_and_removes_unverified_new_entries() {
    let conn = database("plaintext");
    let store = MockStore::default();
    *store.fail_set.borrow_mut() = true;
    assert!(get_api_key_with_store(&conn, &store)
        .unwrap_err()
        .contains("set failure"));
    assert_eq!(load_legacy_secret(&conn).unwrap(), "plaintext");
    assert!(secret(&store, CredentialId::Current).is_none());
    *store.fail_set.borrow_mut() = false;
    reject_database_update(&conn);
    assert!(get_api_key_with_store(&conn, &store)
        .unwrap_err()
        .contains("迁移状态"));
    assert_eq!(load_legacy_secret(&conn).unwrap(), "plaintext");
    assert!(secret(&store, CredentialId::Current).is_none());
}

#[test]
fn alias_migration_restores_both_entries_when_cleanup_cannot_complete() {
    for database_failure in [false, true] {
        let conn = database("plaintext");
        let store = MockStore::default();
        store
            .values
            .borrow_mut()
            .insert(CredentialId::Legacy, "legacy".into());
        if database_failure {
            reject_database_update(&conn);
        } else {
            *store.fail_delete.borrow_mut() = Some(CredentialId::Legacy);
        }
        assert!(get_api_key_with_store(&conn, &store).is_err());
        assert_eq!(
            secret(&store, CredentialId::Legacy).as_deref(),
            Some("legacy")
        );
        assert!(secret(&store, CredentialId::Current).is_none());
        assert_eq!(load_legacy_secret(&conn).unwrap(), "plaintext");
    }
}

#[test]
fn replacing_a_key_restores_the_previous_value_if_either_cleanup_step_fails() {
    for database_failure in [false, true] {
        let conn = database("plaintext");
        let store = MockStore::default();
        store
            .values
            .borrow_mut()
            .insert(CredentialId::Current, "previous".into());
        store
            .values
            .borrow_mut()
            .insert(CredentialId::Legacy, "legacy".into());
        if database_failure {
            reject_database_update(&conn);
        } else {
            *store.fail_delete.borrow_mut() = Some(CredentialId::Legacy);
        }
        let error = save_api_key_with_store(&conn, &store, "replacement").unwrap_err();
        assert!(matches!(error, CredentialStoreError::Failure(_)));
        assert!(!error.to_string().is_empty());
        assert_eq!(
            secret(&store, CredentialId::Current).as_deref(),
            Some("previous")
        );
        assert_eq!(
            secret(&store, CredentialId::Legacy).as_deref(),
            Some("legacy")
        );
    }
}

#[test]
fn deleting_a_key_restores_both_aliases_if_the_deletion_marker_cannot_be_saved() {
    let conn = database("plaintext");
    let store = MockStore::default();
    store
        .values
        .borrow_mut()
        .insert(CredentialId::Current, "current".into());
    store
        .values
        .borrow_mut()
        .insert(CredentialId::Legacy, "legacy".into());
    reject_database_update(&conn);
    let error = delete_api_key_with_store(&conn, &store).unwrap_err();
    assert!(error.to_string().contains("迁移状态"));
    assert_eq!(
        secret(&store, CredentialId::Current).as_deref(),
        Some("current")
    );
    assert_eq!(
        secret(&store, CredentialId::Legacy).as_deref(),
        Some("legacy")
    );
    assert_eq!(load_legacy_secret(&conn).unwrap(), "plaintext");
    assert!(!is_explicitly_deleted(&conn).unwrap());
}
