use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecSong {
    pub id: serde_json::Value,
    pub source: String,
    pub name: String,
    pub artist: String,
    pub album: String,
    #[serde(default)]
    pub pic: Option<String>,
    #[serde(default)]
    pub pic_id: Option<String>,
    #[serde(default)]
    pub url_id: Option<String>,
    #[serde(default)]
    pub lyric_id: Option<String>,
    #[serde(default)]
    pub types: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationItem {
    pub song: RecSong,
    pub score: f64,
    pub reasons: Vec<String>,
    pub recommendation_source: String,
    pub request_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationQuery {
    pub limit: Option<usize>,
    pub seed: Option<RecSong>,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecommendationJobStatus {
    Running,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecommendationJobStage {
    LocalRecall,
    DiscoveryPlan,
    PlatformSearch,
    CloudRerank,
    LocalOnly,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationJob {
    pub job_id: String,
    pub status: RecommendationJobStatus,
    pub stage: RecommendationJobStage,
    pub detail: String,
    pub items: Vec<RecommendationItem>,
    pub error: Option<String>,
    pub updated_at: i64,
}

/// Payload for the `recommendation-job-update` event. Never carries items:
/// the renderer re-fetches the full job once it sees `status == "done"`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationJobUpdatePayload {
    pub job_id: String,
    pub status: RecommendationJobStatus,
    pub stage: RecommendationJobStage,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationEvent {
    pub event_type: String,
    pub song: Option<RecSong>,
    #[serde(default)]
    pub session_id: Option<String>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub quality: Option<String>,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSnapshot {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub songs: Vec<RecSong>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    #[serde(default)]
    pub favorites: Vec<RecSong>,
    #[serde(default)]
    pub playlists: Vec<PlaylistSnapshot>,
    #[serde(default)]
    pub queue: Vec<RecSong>,
    #[serde(default)]
    pub current_song: Option<RecSong>,
    #[serde(default)]
    pub delta: Option<LibraryDelta>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMembershipChange {
    pub container_type: String,
    pub container_id: String,
    pub track_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDelta {
    #[serde(default)]
    pub upsert_songs: Vec<RecSong>,
    #[serde(default)]
    pub added_memberships: Vec<LibraryMembershipChange>,
    #[serde(default)]
    pub removed_memberships: Vec<LibraryMembershipChange>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationFeedback {
    pub request_id: String,
    pub song: RecSong,
    pub action: String,
    pub recommendation_source: String,
    #[serde(default)]
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentEventSummary {
    pub event_type: String,
    pub song_name: String,
    pub artist: String,
    pub age_bucket: String,
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub track_key: String,
    pub song: RecSong,
    pub local_score: f64,
    pub itemcf_score: f64,
    pub profile_score: f64,
    pub artist_match: f64,
    pub source_preference: f64,
    pub recent_penalty: f64,
    pub dismiss_penalty: f64,
    pub quality_bonus: f64,
    pub freshness_bonus: f64,
    pub diversity_seed_score: f64,
    pub reasons: Vec<String>,
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileToken {
    pub key: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfigView {
    pub local_recommendation_enabled: bool,
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u64,
    pub max_candidates: usize,
    pub max_results: usize,
    pub cache_ttl_seconds: i64,
    pub upload_recent_events: bool,
    pub has_api_key: bool,
    pub database_size_bytes: u64,
    pub llm_cache_entries: usize,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u64,
    pub max_candidates: usize,
    pub max_results: usize,
    pub cache_ttl_seconds: i64,
    pub upload_recent_events: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfigInput {
    pub local_recommendation_enabled: Option<bool>,
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub timeout_ms: Option<u64>,
    pub max_candidates: Option<usize>,
    pub max_results: Option<usize>,
    pub cache_ttl_seconds: Option<i64>,
    pub upload_recent_events: Option<bool>,
    pub api_key: Option<String>,
    pub clear_api_key: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderTestResult {
    pub ok: bool,
    pub status: String,
    pub latency_ms: Option<u64>,
    pub supports_json_object: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationMaintenanceStats {
    pub database_size_bytes: u64,
    pub llm_cache_entries: usize,
}
