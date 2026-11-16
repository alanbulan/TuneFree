use super::*;

pub(super) struct RefreshState {
    pub(super) preference_changed_at: i64,
    pub(super) cloud_attempted_at: i64,
}

pub(super) struct CloudRefreshDecision {
    pub(super) start: bool,
    waiting: bool,
    next_at: Option<i64>,
}

pub(super) struct CloudRefreshContext<'a> {
    pub(super) now: i64,
    pub(super) saved: Option<&'a RecommendationJob>,
    pub(super) config: &'a CloudJobConfig,
    pub(super) enabled: bool,
    pub(super) synced: bool,
    pub(super) requested: bool,
    pub(super) state: &'a RefreshState,
}

impl CloudRefreshDecision {
    pub(super) fn apply_state(&self, job: &mut RecommendationJob, cloud_enabled: bool) {
        if self.start || !cloud_enabled {
            return;
        }
        if self.waiting {
            job.status = RecommendationJobStatus::Waiting;
            job.stage = RecommendationJobStage::Waiting;
            job.detail = if self.next_at.is_some() {
                "等待刷新"
            } else {
                "等待曲库同步"
            }
            .into();
            job.next_refresh_at = self.next_at;
        } else {
            job.status = RecommendationJobStatus::Done;
            job.stage = RecommendationJobStage::Cached;
            job.detail = "使用已保存的推荐".into();
        }
    }
}

/// 整轮快照新鲜时，发现规划和重排都不重跑；决策不读取密钥、不调用模型。
pub(super) fn cloud_refresh_decision(input: CloudRefreshContext<'_>) -> CloudRefreshDecision {
    if !input.enabled {
        return CloudRefreshDecision {
            start: false,
            waiting: false,
            next_at: None,
        };
    }
    let fresh = input.saved.is_some_and(|job| {
        !job.items.is_empty()
            && job.result_updated_at > 0
            && input.now.saturating_sub(job.result_updated_at) < input.config.cache_ttl_ms
            && job.result_updated_at >= input.config.configured_at
            && job.result_updated_at > input.state.preference_changed_at
    });
    if !input.requested && fresh {
        return CloudRefreshDecision {
            start: false,
            waiting: false,
            next_at: None,
        };
    }
    if !input.synced {
        return CloudRefreshDecision {
            start: false,
            waiting: true,
            next_at: None,
        };
    }
    let next_at = input
        .state
        .cloud_attempted_at
        .saturating_add(CLOUD_REFRESH_MIN_INTERVAL_MS);
    if input.state.cloud_attempted_at > 0 && input.now < next_at {
        return CloudRefreshDecision {
            start: false,
            waiting: true,
            next_at: Some(next_at),
        };
    }
    CloudRefreshDecision {
        start: true,
        waiting: false,
        next_at: None,
    }
}

pub(super) fn load_refresh_state(
    conn: &Connection,
    in_memory_attempt: i64,
) -> rusqlite::Result<RefreshState> {
    let (preference_changed_at, cloud_attempted_at) = conn.query_row(
        "SELECT preference_changed_at, cloud_attempted_at FROM recommendation_refresh_state WHERE id = 1", [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    Ok(RefreshState {
        preference_changed_at,
        cloud_attempted_at: cloud_attempted_at.max(in_memory_attempt),
    })
}

impl RecommendationService {
    pub(in crate::recommendation::service) fn mark_cloud_preferences_changed(&self) {
        self.cloud_refresh_requested.store(true, Ordering::SeqCst);
        if let Ok(conn) = self.conn_handle() {
            if let Err(error) = conn.lock().execute(
                "UPDATE recommendation_refresh_state SET preference_changed_at = ?1 WHERE id = 1",
                [catalog::now_ms()],
            ) {
                log::warn!("保存推荐失效时间失败: {}", error);
            }
        }
    }
}

#[cfg(test)]
#[path = "../__tests__/freshness.rs"]
mod tests;
