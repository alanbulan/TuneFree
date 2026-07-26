/**
 * TypeScript mirrors of every Rust struct that crosses the IPC boundary.
 * Field names follow the Rust `#[serde(rename_all = "camelCase")]` output;
 * keep them in sync with `src-tauri/src` — do not redeclare these types
 * elsewhere in the frontend.
 */

import type { Song } from "../types";

// ==============================
// 本地服务器
// ==============================

/** Mirror of `LocalServerInfo` (system_commands.rs). */
export interface LocalServerInfo {
  port: number;
  token: string;
}

/** Response shape of `GET /api/allowed-hosts` on the local server. */
export interface AllowedHostsResponse {
  hosts: string[];
}

// ==============================
// 下载
// ==============================

/** Mirror of `DownloadedFile` (downloads/transfer.rs). */
export interface DownloadedFileResult {
  filepath: string;
  filename: string;
}

/** Mirror of `DownloadMetaEntry` (downloads/commands.rs, camelCase serialized). */
export interface OfflineDownloadMeta {
  filename: string;
  song: Song;
  quality: string;
  createTime: number;
  size: number;
}

/** Mirror of `ResolvedPlayback` (downloads/commands.rs). */
export interface ResolvedPlayback {
  filepath: string;
  song: Song;
  quality: string;
}

/** Mirror of `DownloadProgress` (downloads/transfer.rs), event `download-progress`. */
export interface DownloadProgressPayload {
  taskId: string;
  url: string;
  progress: number;
}

// ==============================
// 更新
// ==============================

/** Mirror of `AvailableUpdate` (updater.rs). */
export interface AvailableUpdate {
  version: string;
  notes?: string | null;
}

/** Mirror of `UpdateProgress` (updater.rs), event `update-progress`. */
export interface UpdateProgressPayload {
  progress: number;
}

// ==============================
// 桌面歌词 / 播放器控制事件
// ==============================

/** Mirror of `PlayerControlPayload` (system_commands.rs), event `player-control`. */
export interface PlayerControlPayload {
  action: string;
  value?: unknown;
}

/** 歌曲变更时发送一次（含完整歌词文本），event `lyric-song`。 */
export interface LyricSongPayload {
  /** `${source}:${id}`，接收端据此判重并丢弃过期 tick。 */
  trackKey: string;
  id: string | number;
  title: string;
  artist: string;
  source: string;
  pic?: string;
  lrc: string | null;
  duration: number;
}

/**
 * 播放进度心跳，500ms 一次。
 *
 * 只承载标量：完整 LRC 文本随 `lyric-song` 单独下发，避免每秒两次
 * 跨窗口序列化数十 KB 的歌词。
 */
export interface LyricTickPayload {
  trackKey: string;
  currentTime: number;
  isPlaying: boolean;
  sentAt: number;
  playbackRate: number;
  lyricOffsetSeconds: number;
  lyricDisplayMode: string;
}

/** 主窗口主题变化同步给歌词窗口，event `theme-changed`。 */
export interface ThemeChangedPayload {
  isDark: boolean;
  accent: string;
  accentRgb: string;
  lyricFontFamily: string;
}

// ==============================
// 推荐
// ==============================

export interface RecommendationEvent {
  eventType: string;
  sessionId?: string;
  song?: Song | null;
  positionSeconds?: number;
  durationSeconds?: number;
  quality?: string;
  context?: string;
}

/** Mirror of `RecommendationQuery` (recommendation/model.rs). */
export interface RecommendationQuery {
  limit?: number;
  seed?: Song;
  context?: string;
}

export interface RecommendationItem {
  song: Song;
  score: number;
  reasons: string[];
  recommendationSource: string;
  requestId: string;
}

export interface PlaylistSnapshot {
  id: string;
  name: string;
  songs: Song[];
}

export interface LibraryMembershipChange {
  containerType: "favorite" | "playlist";
  containerId: string;
  trackKey: string;
}

export interface LibraryDelta {
  upsertSongs: Song[];
  addedMemberships: LibraryMembershipChange[];
  removedMemberships: LibraryMembershipChange[];
}

export interface LibrarySnapshot {
  favorites: Song[];
  playlists: PlaylistSnapshot[];
  queue: Song[];
  currentSong?: Song | null;
  delta?: LibraryDelta;
}

export interface RecommendationFeedback {
  requestId: string;
  song: Song;
  action: string;
  recommendationSource: string;
  context?: string;
}

export type RecommendationJobStatus = "running" | "done" | "error";

export type RecommendationJobStage =
  | "local_recall"
  | "discovery_plan"
  | "platform_search"
  | "cloud_rerank"
  | "local_only"
  | "done"
  | "error";

export interface RecommendationJob {
  jobId: string;
  status: RecommendationJobStatus;
  stage: RecommendationJobStage;
  detail: string;
  items: RecommendationItem[];
  error?: string | null;
  updatedAt: number;
}

/** 推荐任务进度事件，event `recommendation-job-update`（items 不随事件下发）。 */
export interface RecommendationJobUpdatePayload {
  jobId: string;
  status: "pending" | "running" | "done" | "error";
  stage: string | null;
  detail: string | null;
}

export interface LlmConfigView {
  localRecommendationEnabled: boolean;
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxCandidates: number;
  maxResults: number;
  cacheTtlSeconds: number;
  uploadRecentEvents: boolean;
  hasApiKey: boolean;
  databaseSizeBytes: number;
  llmCacheEntries: number;
  lastError?: string | null;
}

export interface LlmConfigInput {
  localRecommendationEnabled?: boolean;
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  maxCandidates?: number;
  maxResults?: number;
  cacheTtlSeconds?: number;
  uploadRecentEvents?: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface LlmProviderTestResult {
  ok: boolean;
  status: string;
  latencyMs?: number | null;
  supportsJsonObject: boolean;
  error?: string | null;
}

export interface RecommendationMaintenanceStats {
  databaseSizeBytes: number;
  llmCacheEntries: number;
}
