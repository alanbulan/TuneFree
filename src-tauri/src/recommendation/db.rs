use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::Connection;
use tauri::Manager;

use super::migration;

/// How long a connection waits for a competing writer before failing.
/// WAL keeps readers unblocked; this only matters for concurrent writes
/// (e.g. the maintenance connection rebuilding indexes).
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub struct RecommendationDatabase {
    pub conn: Connection,
    pub path: PathBuf,
}

pub fn open_database(app_handle: &tauri::AppHandle) -> Result<RecommendationDatabase, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    let db_dir = app_data_dir.join("tunefree");
    fs::create_dir_all(&db_dir).map_err(|e| format!("创建推荐数据库目录失败: {}", e))?;
    open_database_at(db_dir.join("recommendation.sqlite"))
}

pub fn open_database_at(db_path: PathBuf) -> Result<RecommendationDatabase, String> {
    let conn = open_connection(&db_path)?;
    migration::run_migrations(&conn).map_err(|e| format!("执行推荐数据库迁移失败: {}", e))?;

    Ok(RecommendationDatabase {
        conn,
        path: db_path,
    })
}

/// Opens a second connection to an already-migrated database so heavy
/// maintenance work never holds the service-wide connection mutex. Relies on
/// WAL mode so this writer coexists with concurrent readers.
pub fn open_maintenance_connection(db_path: &Path) -> Result<Connection, String> {
    open_connection(db_path)
}

fn open_connection(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("打开推荐数据库失败: {}", e))?;
    conn.busy_timeout(BUSY_TIMEOUT)
        .map_err(|e| format!("设置推荐数据库 busy_timeout 失败: {}", e))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("设置推荐数据库 WAL 失败: {}", e))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("设置推荐数据库 synchronous 失败: {}", e))?;
    Ok(conn)
}
