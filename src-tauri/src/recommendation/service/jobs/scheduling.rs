use super::*;

impl RecommendationService {
    pub(in crate::recommendation::service) fn invalidate_and_schedule_refresh(
        &self,
        reason: &'static str,
    ) {
        self.invalidate_current_tasks();
        self.schedule_dynamic_recommendation_refresh(reason);
    }

    pub(in crate::recommendation::service) fn invalidate_current_tasks(&self) {
        self.invalidate_tasks_with_dismissal(None);
    }

    pub(in crate::recommendation::service) fn invalidate_dismissal_and_schedule_refresh(
        &self,
        song: &RecSong,
    ) {
        self.invalidate_tasks_with_dismissal(Some(song));
        self.schedule_dynamic_recommendation_refresh("不感兴趣反馈");
    }

    fn invalidate_tasks_with_dismissal(&self, dismissed: Option<&RecSong>) {
        let cancel = self.cloud_cancel.lock();
        // 与云端完成共享发布锁，移除的歌曲不能被同时完成的旧结果重新插回。
        if let Some(song) = dismissed {
            self.remove_dismissed_from_jobs(song);
        }
        self.mark_cloud_preferences_changed();
        let transitions = invalidate_recommendation_state(
            &self.recommendation_generation,
            &self.recommendation_jobs,
            &self.dynamic_refresh_pending,
        );
        let _ = cancel.send(true);
        for payload in transitions {
            emit_job_payload(self.app_handle(), payload);
        }
    }

    pub(in crate::recommendation::service) fn schedule_dynamic_recommendation_refresh(
        &self,
        reason: &'static str,
    ) {
        let _publication_guard = self.cloud_cancel.lock();
        if self.dynamic_refresh_pending.swap(true, Ordering::SeqCst) {
            return;
        }
        let service = self.clone();
        let generation = self.recommendation_generation.load(Ordering::SeqCst);
        self.publish_refresh_waiting();
        if !self.is_recommendation_enabled() {
            self.dynamic_refresh_pending.store(false, Ordering::SeqCst);
            return;
        }
        tauri::async_runtime::spawn(async move {
            service.run_scheduled_refresh(generation, reason).await;
            let _publication_guard = service.cloud_cancel.lock();
            if state::is_current_generation(
                generation,
                service.recommendation_generation.load(Ordering::SeqCst),
            ) {
                service
                    .dynamic_refresh_pending
                    .store(false, Ordering::SeqCst);
            }
        });
    }

    fn publish_refresh_waiting(&self) {
        if self.has_running_recommendation_job() {
            return;
        }
        let enabled = self.is_recommendation_enabled();
        let previous = self
            .latest_recommendation_job()
            .or_else(|| self.latest_cloud_recommendation_job("home"));
        let mut job = previous.unwrap_or_else(state::idle_job);
        if !enabled {
            job = disabled_job();
        } else {
            job.job_id = state::new_job_id();
            job.status = RecommendationJobStatus::Waiting;
            job.stage = RecommendationJobStage::Waiting;
            job.detail = "等待刷新".into();
            job.deadline_at = None;
            job.error = None;
            job.cloud_enabled = self.has_cloud_recommendation_config();
            job.updated_at = catalog::now_ms();
            let local_ready_at = if self.cloud_refresh_requested.load(Ordering::SeqCst) {
                0
            } else {
                self.last_dynamic_refresh_at
                    .load(Ordering::SeqCst)
                    .saturating_add(DYNAMIC_REFRESH_MIN_INTERVAL_MS)
            };
            job.next_refresh_at = Some(
                job.updated_at
                    .saturating_add(DYNAMIC_REFRESH_DEBOUNCE_MS as i64)
                    .max(local_ready_at)
                    .max(job.next_refresh_at.unwrap_or(0)),
            );
        }
        *self.current_job_id.lock() = Some(job.job_id.clone());
        self.recommendation_jobs
            .lock()
            .insert(job.job_id.clone(), job.clone());
        updates::emit_job_update(self.app_handle(), &job);
    }

    async fn run_scheduled_refresh(&self, generation: u64, reason: &'static str) {
        let mut delay_ms = DYNAMIC_REFRESH_DEBOUNCE_MS;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            if self.recommendation_generation.load(Ordering::SeqCst) != generation {
                return;
            }
            let worker = self.clone();
            if !matches!(
                run_recommendation_blocking(move || Ok(worker.is_recommendation_enabled())).await,
                Ok(true)
            ) {
                return;
            }
            if self.has_running_recommendation_job() {
                delay_ms = DYNAMIC_REFRESH_RUNNING_RETRY_MS;
                continue;
            }
            let elapsed = catalog::now_ms()
                .saturating_sub(self.last_dynamic_refresh_at.load(Ordering::SeqCst));
            if !self.cloud_refresh_requested.load(Ordering::SeqCst)
                && elapsed < DYNAMIC_REFRESH_MIN_INTERVAL_MS
            {
                delay_ms = (DYNAMIC_REFRESH_MIN_INTERVAL_MS - elapsed) as u64;
                continue;
            }
            let worker = self.clone();
            let refresh = run_recommendation_blocking(move || {
                if worker.recommendation_generation.load(Ordering::SeqCst) != generation {
                    return Err(CommandError::cancelled("推荐请求已过期"));
                }
                let prepared = worker.prepare_recommendation_job(home_query())?;
                if prepared.generation != generation {
                    return Err(CommandError::cancelled("推荐请求已过期"));
                }
                worker.publish_recommendation_job(prepared)
            })
            .await;
            match refresh {
                Ok(job)
                    if matches!(job.status, RecommendationJobStatus::Waiting)
                        && job.next_refresh_at.is_some() =>
                {
                    delay_ms = job
                        .next_refresh_at
                        .unwrap()
                        .saturating_sub(catalog::now_ms())
                        .max(1) as u64;
                }
                Ok(_) => {
                    log::info!("已刷新推荐: {}", reason);
                    return;
                }
                Err(error) => {
                    self.publish_scheduling_error(generation, &error);
                    return;
                }
            }
        }
    }

    fn publish_scheduling_error(&self, generation: u64, error: &CommandError) {
        let _publication_guard = self.cloud_cancel.lock();
        if self.recommendation_generation.load(Ordering::SeqCst) != generation {
            return;
        }
        log::error!("动态刷新推荐失败: {}", error);
        let Some(mut job) = self.latest_recommendation_job() else {
            return;
        };
        job.status = RecommendationJobStatus::Error;
        job.stage = RecommendationJobStage::Error;
        job.detail = "暂时无法刷新推荐".into();
        job.error = Some(error.message.clone());
        job.next_refresh_at = None;
        job.updated_at = catalog::now_ms();
        self.recommendation_jobs
            .lock()
            .insert(job.job_id.clone(), job.clone());
        updates::emit_job_update(self.app_handle(), &job);
    }
}
