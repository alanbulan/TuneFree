use super::*;

impl RecommendationService {
    pub fn dismiss(&self, song: RecSong, reason: Option<String>) -> CommandResult<()> {
        let conn = self.conn_handle()?;
        {
            let mut conn = conn.lock();
            let tx = conn
                .transaction()
                .map_err(|e| CommandError::database(format!("开启不感兴趣事务失败: {}", e)))?;
            record_dismissal(&tx, &song, reason.as_deref(), "recommendation")
                .map_err(CommandError::database)?;
            tx.commit()
                .map_err(|e| CommandError::database(format!("提交不感兴趣事务失败: {}", e)))?;
        }
        self.invalidate_dismissal_and_schedule_refresh(&song);
        Ok(())
    }

    pub fn save_feedback(&self, feedback: RecommendationFeedback) -> CommandResult<()> {
        let conn = self.conn_handle()?;
        let inserted = {
            let mut conn = conn.lock();
            record_recommendation_feedback(&mut conn, &feedback).map_err(CommandError::database)?
        };
        if !inserted {
            return Ok(());
        }
        if feedback.action == "dismiss" {
            self.invalidate_dismissal_and_schedule_refresh(&feedback.song);
        } else {
            let event_type = feedback_event_type(&feedback)?;
            self.handle_event_signal(event_type, events::event_weight(event_type));
        }
        Ok(())
    }

    pub(in crate::recommendation::service) fn remove_dismissed_from_jobs(&self, song: &RecSong) {
        let identity = catalog::song_identity(song);
        for job in self.recommendation_jobs.lock().values_mut() {
            job.items
                .retain(|item| catalog::song_identity(&item.song) != identity);
        }
    }
}

fn feedback_event_type(feedback: &RecommendationFeedback) -> CommandResult<&'static str> {
    match feedback.action.as_str() {
        "play" if feedback.recommendation_source == "hybrid" => Ok("llm_recommend_click"),
        "play" if feedback.context.as_deref() == Some("similar") => Ok("similar_click"),
        "play" => Ok("recommendation_click"),
        "dismiss" => Ok("dismiss"),
        _ => Err(CommandError::invalid_argument("不支持的推荐反馈动作")),
    }
}

fn record_dismissal(
    conn: &Connection,
    song: &RecSong,
    reason: Option<&str>,
    context: &str,
) -> Result<(), String> {
    let key =
        catalog::upsert_track(conn, song).map_err(|e| format!("保存不感兴趣歌曲失败: {}", e))?;
    let now = catalog::now_ms();
    let expires_at = now + 14 * 24 * 60 * 60 * 1000;
    conn.execute(
        r#"
        INSERT INTO dismissed_recommendations (track_key, reason, created_at, expires_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(track_key) DO UPDATE SET
          reason = excluded.reason,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
        "#,
        params![key, reason, now, expires_at],
    )
    .map_err(|e| format!("保存不感兴趣失败: {}", e))?;

    let event = RecommendationEvent {
        event_type: "dismiss".to_string(),
        song: Some(song.clone()),
        session_id: None,
        position_seconds: None,
        duration_seconds: None,
        quality: None,
        context: Some(context.to_string()),
    };
    events::insert_event(conn, &event).map_err(|e| format!("写入不感兴趣事件失败: {}", e))?;
    profile::update_profile_for_song(conn, song, events::event_weight("dismiss"), None)
        .map_err(|e| format!("更新不感兴趣画像失败: {}", e))?;
    Ok(())
}

pub(super) fn record_recommendation_feedback(
    conn: &mut Connection,
    feedback: &RecommendationFeedback,
) -> Result<bool, String> {
    let event_type = feedback_event_type(feedback).map_err(|error| error.message)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启推荐反馈事务失败: {}", e))?;
    let track_key = catalog::upsert_track(&tx, &feedback.song)
        .map_err(|e| format!("保存推荐反馈歌曲失败: {}", e))?;
    if feedback.action == "dismiss" && tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM recommendation_feedback WHERE request_id = ?1 AND track_key = ?2 AND action = 'dismiss')",
        params![feedback.request_id, track_key], |row| row.get::<_, bool>(0),
    ).map_err(|e| format!("检查重复不感兴趣反馈失败: {}", e))? {
        return Ok(false);
    }
    tx.execute(
        r#"
        INSERT INTO recommendation_feedback
          (request_id, track_key, action, recommendation_source, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
        params![
            feedback.request_id,
            track_key,
            feedback.action,
            feedback.recommendation_source,
            catalog::now_ms(),
        ],
    )
    .map_err(|e| format!("保存推荐反馈失败: {}", e))?;

    if event_type == "dismiss" {
        record_dismissal(
            &tx,
            &feedback.song,
            Some("not_interested"),
            feedback.context.as_deref().unwrap_or("recommendation"),
        )?;
    } else {
        let event = RecommendationEvent {
            event_type: event_type.to_string(),
            song: Some(feedback.song.clone()),
            session_id: None,
            position_seconds: None,
            duration_seconds: None,
            quality: None,
            context: Some(
                feedback
                    .context
                    .clone()
                    .unwrap_or_else(|| "recommendation".to_string()),
            ),
        };
        events::insert_event(&tx, &event).map_err(|e| format!("写入推荐反馈事件失败: {}", e))?;
        profile::update_profile_for_song(
            &tx,
            &feedback.song,
            events::event_weight(event_type),
            None,
        )
        .map_err(|e| format!("更新推荐反馈画像失败: {}", e))?;
    }
    tx.commit()
        .map_err(|e| format!("提交推荐反馈事务失败: {}", e))?;
    Ok(true)
}
