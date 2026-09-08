use super::*;
use crate::recommendation::service::tests::initialized_service;
use crate::test_support::TempDir;

fn insert_expired_event(service: &RecommendationService) {
    service.conn_handle().unwrap().lock().execute(
        "INSERT INTO play_events(event_type,session_id,weight,created_at) VALUES('play_complete','expired',4,1)", [],
    ).unwrap();
}

#[test]
fn scheduled_maintenance_uses_its_own_disk_connection_and_observes_the_interval() {
    let app = crate::test_support::app();
    let pending = RecommendationService::new_deferred(app.handle().clone(), reqwest::Client::new());
    assert!(pending.run_maintenance_once().is_err());
    let memory = initialized_service(&app);
    insert_expired_event(&memory);
    assert!(memory.run_maintenance_once().unwrap());
    assert!(!memory.run_maintenance_once().unwrap());
    let directory = TempDir::new();
    let database = db::open_database_at(directory.0.join("library.sqlite")).unwrap();
    assert!(pending
        .db
        .set(DbHandle {
            conn: Arc::new(Mutex::new(database.conn)),
            path: database.path,
        })
        .is_ok());
    insert_expired_event(&pending);
    assert!(pending.run_maintenance_once().unwrap());
    assert!(!pending.run_maintenance_once().unwrap());
    let handle = pending.conn_handle().unwrap();
    let last_run: i64 = handle
        .lock()
        .query_row(
            "SELECT last_run_at FROM recommendation_maintenance WHERE id=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(last_run > 0);
    drop(handle);
    drop(pending);
}

#[test]
fn corrupted_saved_recommendations_do_not_prevent_loading_the_latest_job() {
    let conn = Connection::open_in_memory().unwrap();
    migration::run_migrations(&conn).unwrap();
    conn.execute(
        "INSERT INTO recommendation_result_snapshots(context,result_source,job_id,detail,items_json,created_at) VALUES('home','cloud','saved','done','invalid',1)", [],
    ).unwrap();
    let job = load_latest_cloud_recommendation_job(&conn, "home")
        .unwrap()
        .unwrap();
    assert_eq!(job.job_id, "saved");
    assert!(job.items.is_empty());
    assert!(matches!(job.status, RecommendationJobStatus::Done));
}
