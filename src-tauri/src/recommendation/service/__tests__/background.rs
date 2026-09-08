use super::*;
use crate::test_support::TempDir;

fn with_database(app: &tauri::App, database: db::RecommendationDatabase) -> RecommendationService {
    let service = RecommendationService::new_deferred(app.handle().clone(), reqwest::Client::new());
    assert!(service
        .db
        .set(DbHandle {
            conn: Arc::new(Mutex::new(database.conn)),
            path: database.path,
        })
        .is_ok());
    service
}

#[tokio::test]
async fn deferred_rebuilds_work_for_disk_memory_and_a_failed_secondary_connection() {
    let app = crate::test_support::app();
    let pending = RecommendationService::new_deferred(app.handle().clone(), reqwest::Client::new());
    pending.run_pending_rebuilds_in_background().await;
    assert!(pending.db.get().is_none());
    let directory = TempDir::new();
    let disk = with_database(
        &app,
        db::open_database_at(directory.0.join("library.sqlite")).unwrap(),
    );
    disk.run_pending_rebuilds_in_background().await;
    disk.run_pending_rebuilds_in_background().await;
    assert!(!migration::run_pending_rebuilds(&disk.conn_handle().unwrap().lock()).unwrap());
    drop(disk);
    for path in [
        PathBuf::new(),
        directory.0.join("missing").join("library.sqlite"),
    ] {
        let conn = Connection::open_in_memory().unwrap();
        migration::run_migrations(&conn).unwrap();
        let service = with_database(&app, db::RecommendationDatabase { conn, path });
        service.run_pending_rebuilds_in_background().await;
        assert!(!migration::run_pending_rebuilds(&service.conn_handle().unwrap().lock()).unwrap());
    }
}

#[tokio::test]
async fn a_failed_background_rebuild_keeps_the_database_available() {
    let app = crate::test_support::app();
    let service = tests::initialized_service(&app);
    let conn = service.conn_handle().unwrap();
    conn.lock()
        .execute_batch("DROP TABLE user_profile")
        .unwrap();
    service.run_pending_rebuilds_in_background().await;
    assert!(migration::run_pending_rebuilds(&conn.lock()).is_err());
    assert!(llm_config::load_config(&conn.lock()).is_ok());
}
