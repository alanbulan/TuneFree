use super::*;

#[test]
fn stale_dynamic_refresh_task_does_not_clear_new_generation() {
    assert!(is_current_generation(2, 2));
    assert!(!is_current_generation(1, 2));

    let generation = AtomicU64::new(2);
    let pending = AtomicBool::new(true);
    let jobs = Mutex::new(HashMap::from([
        (
            "running".to_string(),
            RecommendationJob {
                job_id: "running".to_string(),
                status: RecommendationJobStatus::Running,
                stage: RecommendationJobStage::CloudRerank,
                detail: String::new(),
                items: Vec::new(),
                error: None,
                updated_at: 1,
            },
        ),
        (
            "done".to_string(),
            RecommendationJob {
                job_id: "done".to_string(),
                status: RecommendationJobStatus::Done,
                stage: RecommendationJobStage::Done,
                detail: String::new(),
                items: Vec::new(),
                error: None,
                updated_at: 1,
            },
        ),
    ]));
    invalidate_recommendation_state(&generation, &jobs, &pending);
    assert_eq!(generation.load(Ordering::SeqCst), 3);
    assert!(!pending.load(Ordering::SeqCst));
    assert!(matches!(
        &jobs.lock().get("running").unwrap().status,
        RecommendationJobStatus::Done
    ));
    assert!(jobs.lock().contains_key("done"));
}
