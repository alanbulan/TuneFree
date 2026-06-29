use std::{fs, path::PathBuf, time::Duration};

use rusqlite::Connection;
use tauri::Manager;

use super::migration;

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
    let db_path = db_dir.join("recommendation.sqlite");

    let conn = Connection::open(&db_path).map_err(|e| format!("打开推荐数据库失败: {}", e))?;
    conn.busy_timeout(Duration::from_secs(2))
        .map_err(|e| format!("设置推荐数据库 busy_timeout 失败: {}", e))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("设置推荐数据库 WAL 失败: {}", e))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("设置推荐数据库 synchronous 失败: {}", e))?;
    migration::run_migrations(&conn).map_err(|e| format!("执行推荐数据库迁移失败: {}", e))?;

    Ok(RecommendationDatabase {
        conn,
        path: db_path,
    })
}
