use super::library::rebuild_cooccurrence_index;
use super::*;

impl RecommendationService {
    pub fn get_llm_config(&self) -> Result<LlmConfigView, String> {
        let conn = self.conn.lock();
        llm_config::view_config(
            &conn,
            self.database_size_bytes(),
            self.last_llm_error.lock().clone(),
        )
    }

    pub fn save_llm_config(&self, config: LlmConfigInput) -> Result<(), String> {
        let conn = self.conn.lock();
        llm_config::save_config(&conn, config)?;
        drop(conn);
        self.invalidate_and_schedule_refresh("推荐配置更新");
        Ok(())
    }

    pub async fn test_llm_provider(
        &self,
        input: Option<LlmConfigInput>,
    ) -> Result<LlmProviderTestResult, String> {
        let (config, api_key) = {
            let input_ref = input.as_ref();
            let config = if let Some(input) = input.clone() {
                llm_config::config_from_input(&input)
            } else {
                let conn = self.conn.lock();
                llm_config::load_config(&conn).map_err(|e| format!("读取模型配置失败: {}", e))?
            };
            let api_key = if input_ref
                .and_then(|value| value.clear_api_key)
                .unwrap_or(false)
            {
                input_ref
                    .and_then(|value| value.api_key.as_deref())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("")
                    .to_string()
            } else {
                match input_ref
                    .and_then(|value| value.api_key.as_deref())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    Some(api_key) => api_key.to_string(),
                    None => {
                        let conn = self.conn.lock();
                        llm_config::get_api_key(&conn)?
                    }
                }
            };
            (config, api_key)
        };
        let result = self.provider.test(&config, &api_key).await;
        *self.last_llm_error.lock() = result.error.clone();
        Ok(result)
    }

    pub fn clear_data(&self) -> Result<RecommendationMaintenanceStats, String> {
        self.recommendation_generation
            .fetch_add(1, Ordering::SeqCst);
        let clear_result = {
            let conn = self.conn.lock();
            clear_recommendation_storage(&conn)
        };
        self.recommendation_jobs.lock().clear();
        self.dynamic_refresh_pending.store(false, Ordering::SeqCst);
        *self.last_llm_error.lock() = None;
        clear_result.map_err(|e| format!("清空推荐数据失败: {}", e))?;
        Ok(self.maintenance_stats())
    }

    pub fn maintenance_stats(&self) -> RecommendationMaintenanceStats {
        let conn = self.conn.lock();
        let llm_cache_entries = conn
            .query_row("SELECT COUNT(*) FROM llm_recommendation_cache", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap_or(0)
            .max(0) as usize;
        RecommendationMaintenanceStats {
            database_size_bytes: self.database_size_bytes(),
            llm_cache_entries,
        }
    }

    fn database_size_bytes(&self) -> u64 {
        std::fs::metadata(&self.db_path)
            .map(|meta| meta.len())
            .unwrap_or(0)
    }

    pub(super) fn schedule_maintenance(&self) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let conn = Arc::clone(&service.conn);
                let result = tauri::async_runtime::spawn_blocking(move || {
                    let mut guard = conn.lock();
                    run_recommendation_maintenance(&mut guard)
                })
                .await;
                match result {
                    Ok(Ok(true)) => {
                        log::info!("推荐数据库定期维护已完成并更新推荐状态");
                        service.invalidate_and_schedule_refresh("推荐数据定期维护");
                    }
                    Ok(Ok(false)) => {}
                    Ok(Err(error)) => log::error!("推荐数据库定期维护失败: {}", error),
                    Err(error) => log::error!("推荐数据库维护任务异常: {}", error),
                }
                tokio::time::sleep(std::time::Duration::from_millis(MAINTENANCE_POLL_MS)).await;
            }
        });
    }
}

pub(super) fn load_latest_cloud_recommendation_job(
    conn: &Connection,
    context: &str,
) -> rusqlite::Result<Option<RecommendationJob>> {
    conn.query_row(
        r#"
        SELECT job_id, detail, items_json, created_at
        FROM recommendation_result_snapshots
        WHERE context = ?1 AND result_source = 'cloud'
        ORDER BY created_at DESC
        LIMIT 1
        "#,
        params![context],
        |row| {
            let job_id: String = row.get(0)?;
            let detail: String = row.get(1)?;
            let items_json: String = row.get(2)?;
            let updated_at: i64 = row.get(3)?;
            let items = serde_json::from_str::<Vec<RecommendationItem>>(&items_json)
                .unwrap_or_else(|error| {
                    log::warn!("解析云端推荐快照失败，按空结果降级: {}", error);
                    Vec::new()
                });
            Ok(RecommendationJob {
                job_id,
                status: RecommendationJobStatus::Done,
                stage: RecommendationJobStage::Done,
                detail,
                items,
                error: None,
                updated_at,
            })
        },
    )
    .optional()
}

pub(super) fn save_cloud_recommendation_result(
    conn: &Connection,
    context: &str,
    job_id: &str,
    detail: &str,
    items: &[RecommendationItem],
) -> Result<(), String> {
    let items_json =
        serde_json::to_string(items).map_err(|e| format!("序列化云端推荐结果失败: {}", e))?;
    conn.execute(
        r#"
        INSERT INTO recommendation_result_snapshots (
          context, result_source, job_id, detail, items_json, created_at
        ) VALUES (?1, 'cloud', ?2, ?3, ?4, ?5)
        "#,
        params![context, job_id, detail, items_json, catalog::now_ms()],
    )
    .map(|_| ())
    .map_err(|e| format!("保存云端推荐结果失败: {}", e))
}

pub(super) fn clear_recommendation_storage(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        DELETE FROM play_events;
        DELETE FROM user_profile;
        DELETE FROM library_profile;
        DELETE FROM item_cooccurrence;
        DELETE FROM library_membership;
        DELETE FROM recommendation_cache;
        DELETE FROM recommendation_result_snapshots;
        DELETE FROM dismissed_recommendations;
        DELETE FROM recommendation_feedback;
        DELETE FROM llm_recommendation_cache;
        DELETE FROM llm_calls;
        "#,
    )
}

fn run_recommendation_maintenance(conn: &mut Connection) -> Result<bool, String> {
    run_recommendation_maintenance_at(conn, catalog::now_ms())
}

pub(super) fn run_recommendation_maintenance_at(
    conn: &mut Connection,
    now: i64,
) -> Result<bool, String> {
    if !maintenance_due(conn, now)? {
        return Ok(false);
    }
    let tx = conn
        .transaction()
        .map_err(|error| format!("开启推荐维护事务失败: {}", error))?;
    let (removed_events, removed_dismissals) = prune_retained_data(&tx, now)?;
    prune_result_snapshots(&tx, now)?;
    rebuild_retained_indexes(&tx, now)?;
    save_maintenance_time(&tx, now)?;
    tx.commit()
        .map_err(|error| format!("提交推荐维护事务失败: {}", error))?;
    Ok(removed_events > 0 || removed_dismissals > 0)
}

fn maintenance_due(conn: &Connection, now: i64) -> Result<bool, String> {
    let last_run_at = conn
        .query_row(
            "SELECT last_run_at FROM recommendation_maintenance WHERE id = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("读取推荐维护时间失败: {}", error))?
        .unwrap_or(0);
    Ok(now.saturating_sub(last_run_at) >= MAINTENANCE_INTERVAL_MS)
}

fn prune_retained_data(conn: &Connection, now: i64) -> Result<(usize, usize), String> {
    let removed_play_events = conn
        .execute(
            "DELETE FROM play_events WHERE created_at < ?1",
            [now - PLAY_EVENT_RETENTION_MS],
        )
        .map_err(|error| format!("清理历史播放事件失败: {}", error))?;
    conn.execute(
        "DELETE FROM recommendation_feedback WHERE created_at < ?1",
        [now - FEEDBACK_RETENTION_MS],
    )
    .map_err(|error| format!("清理历史推荐反馈失败: {}", error))?;
    conn.execute(
        "DELETE FROM llm_calls WHERE created_at < ?1",
        [now - LLM_CALL_RETENTION_MS],
    )
    .map_err(|error| format!("清理模型调用日志失败: {}", error))?;
    conn.execute(
        "DELETE FROM recommendation_cache WHERE generated_at < ?1",
        [now - RESULT_SNAPSHOT_RETENTION_MS],
    )
    .map_err(|error| format!("清理历史本地推荐缓存失败: {}", error))?;
    conn.execute(
        "DELETE FROM llm_recommendation_cache WHERE expires_at <= ?1",
        [now],
    )
    .map_err(|error| format!("清理过期模型缓存失败: {}", error))?;
    let removed_dismissals = conn
        .execute(
            "DELETE FROM dismissed_recommendations WHERE expires_at <= ?1",
            [now],
        )
        .map_err(|error| format!("清理过期不感兴趣记录失败: {}", error))?;
    Ok((removed_play_events, removed_dismissals))
}

fn prune_result_snapshots(conn: &Connection, now: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM recommendation_result_snapshots WHERE created_at < ?1",
        [now - RESULT_SNAPSHOT_RETENTION_MS],
    )
    .map_err(|error| format!("清理过期推荐结果失败: {}", error))?;
    conn.execute(
        r#"
        DELETE FROM recommendation_result_snapshots
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                     PARTITION BY context, result_source
                     ORDER BY created_at DESC, id DESC
                   ) AS row_number
            FROM recommendation_result_snapshots
          ) ranked
          WHERE row_number > ?1
        )
        "#,
        [RESULT_SNAPSHOT_LIMIT],
    )
    .map_err(|error| format!("清理历史推荐结果失败: {}", error))?;
    Ok(())
}

fn rebuild_retained_indexes(conn: &Connection, now: i64) -> Result<(), String> {
    profile::rebuild_profile_from_events(conn)
        .map_err(|error| format!("重建保留期推荐画像失败: {}", error))?;
    rebuild_cooccurrence_index(conn).map_err(|error| format!("重建保留期共现失败: {}", error))?;
    conn.execute(
        r#"
        DELETE FROM tracks
        WHERE last_seen_at < ?1
          AND NOT EXISTS (
            SELECT 1 FROM library_membership m WHERE m.track_key = tracks.track_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM play_events e WHERE e.track_key = tracks.track_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM recommendation_feedback f WHERE f.track_key = tracks.track_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM dismissed_recommendations d WHERE d.track_key = tracks.track_key
          )
        "#,
        [now - PLAY_EVENT_RETENTION_MS],
    )
    .map_err(|error| format!("清理孤立推荐歌曲失败: {}", error))?;
    Ok(())
}

fn save_maintenance_time(conn: &Connection, now: i64) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO recommendation_maintenance (id, last_run_at)
        VALUES (1, ?1)
        ON CONFLICT(id) DO UPDATE SET last_run_at = excluded.last_run_at
        "#,
        [now],
    )
    .map(|_| ())
    .map_err(|error| format!("保存推荐维护时间失败: {}", error))
}
