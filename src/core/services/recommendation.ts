import { invokeCommand } from '../ipc/commands';
import { isTauri } from '../ipc/env';
import type {
  LibraryDelta,
  LibraryMembershipChange,
  LibrarySnapshot,
  LlmConfigInput,
  LlmConfigView,
  LlmProviderTestResult,
  RecommendationEvent,
  RecommendationFeedback,
  RecommendationItem,
  RecommendationJob,
  RecommendationJobStage,
  RecommendationJobStatus,
  RecommendationMaintenanceStats,
} from '../ipc/types';
import type { Song } from '../types';
import { normalizeMusicUrl } from './utils';
import { stripRuntimeSongFields } from './songStorage';

export const RECOMMENDATION_CHANGED_EVENT = 'tunefree:recommendation-changed';
let configCacheVersion = 0;
const notifyRecommendationChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECOMMENDATION_CHANGED_EVENT));
};

const cacheRecommendationEnabled = (enabled: boolean) => {
  try { localStorage.setItem('tunefree_local_recommendation_enabled', String(enabled)); }
  catch (error) { console.warn('缓存推荐设置失败', error); }
};

export type {
  LibraryDelta,
  LibraryMembershipChange,
  LibrarySnapshot,
  LlmConfigInput,
  LlmConfigView,
  LlmProviderTestResult,
  RecommendationEvent,
  RecommendationFeedback,
  RecommendationItem,
  RecommendationJob,
  RecommendationJobStage,
  RecommendationJobStatus,
  RecommendationMaintenanceStats,
};

const isLocalRecommendationEnabled = (): boolean =>
  typeof window === 'undefined' ||
  localStorage.getItem('tunefree_local_recommendation_enabled') !== 'false';

export interface RecommendationOptions {
  limit?: number;
  seed?: Song;
  context?: string;
}

const toRecommendedSong = (item: RecommendationItem): Song => {
  const pic = normalizeMusicUrl(item.song.pic);
  return {
    ...item.song,
    ...(item.song.pic ? { pic } : {}),
    recommendationReasons: item.reasons,
    recommendationSource: item.recommendationSource,
    recommendationRequestId: item.requestId,
    recommendationScore: item.score,
  };
};

export const attachRecommendationMeta = (items: RecommendationItem[]): Song[] =>
  items.map(toRecommendedSong);

export async function logRecommendationEvent(event: RecommendationEvent): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invokeCommand('log_recommendation_event', { event: { ...event,
    ...(event.song ? { song: stripRuntimeSongFields(event.song) } : {}),
  } });
}

export async function syncRecommendationLibrary(snapshot: LibrarySnapshot): Promise<boolean> {
  if (!isTauri()) return false;
  const stableSnapshot = {
    ...snapshot, favorites: snapshot.favorites.map(stripRuntimeSongFields),
    playlists: snapshot.playlists.map((playlist) => ({ ...playlist, songs: playlist.songs.map(stripRuntimeSongFields) })),
    queue: snapshot.queue.map(stripRuntimeSongFields),
    currentSong: snapshot.currentSong ? stripRuntimeSongFields(snapshot.currentSong) : null,
    ...(snapshot.delta ? { delta: { ...snapshot.delta, upsertSongs: snapshot.delta.upsertSongs.map(stripRuntimeSongFields) } } : {}),
  };
  return invokeCommand('sync_recommendation_library', { snapshot: stableSnapshot });
}

export async function getRecommendationJob(jobId: string): Promise<RecommendationJob | null> {
  if (!isTauri()) return null;
  return invokeCommand('get_recommendation_job', { jobId });
}

export async function getLatestRecommendationJob(): Promise<RecommendationJob | null> {
  if (!isTauri()) return null;
  return invokeCommand('get_latest_recommendation_job');
}

export async function getSimilarSongs(
  song: Song,
  options: RecommendationOptions = {},
): Promise<RecommendationItem[]> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return [];
  return invokeCommand('get_similar_songs', {
    song: stripRuntimeSongFields(song),
    limit: options.limit,
  });
}

export async function dismissRecommendation(song: Song, reason?: string): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invokeCommand('dismiss_recommendation', { song: stripRuntimeSongFields(song), reason });
}

export async function saveRecommendationFeedback(
  feedback: RecommendationFeedback,
): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invokeCommand('save_recommendation_feedback', { feedback: { ...feedback, song: stripRuntimeSongFields(feedback.song) } });
}

export async function rebuildRecommendationIndex(): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invokeCommand('rebuild_recommendation_index');
}

export async function getLlmConfig(): Promise<LlmConfigView> {
  if (!isTauri()) {
    return {
      localRecommendationEnabled: true,
      enabled: false,
      baseUrl: '',
      model: '',
      timeoutMs: 8000,
      maxCandidates: 80,
      maxResults: 30,
      cacheTtlSeconds: 86400,
      uploadRecentEvents: false,
      hasApiKey: false,
      databaseSizeBytes: 0,
      llmCacheEntries: 0,
      lastError: null,
    };
  }
  const request = ++configCacheVersion;
  const config = await invokeCommand('get_llm_config');
  if (request === configCacheVersion) cacheRecommendationEnabled(config.localRecommendationEnabled);
  return config;
}

export async function saveLlmConfig(config: LlmConfigInput): Promise<void> {
  if (!isTauri()) return;
  await invokeCommand('save_llm_config', { config });
  configCacheVersion += 1;
  if (config.localRecommendationEnabled !== undefined) cacheRecommendationEnabled(config.localRecommendationEnabled);
  notifyRecommendationChanged();
}

export async function testLlmProvider(config?: LlmConfigInput): Promise<LlmProviderTestResult> {
  if (!isTauri()) {
    return {
      ok: false,
      status: 'browser_preview',
      supportsJsonObject: false,
      error: '当前环境不是 Tauri 桌面端',
    };
  }
  return invokeCommand('test_llm_provider', { config });
}

export async function clearRecommendationData(): Promise<RecommendationMaintenanceStats> {
  if (!isTauri()) return { databaseSizeBytes: 0, llmCacheEntries: 0 };
  const result = await invokeCommand('clear_recommendation_data');
  notifyRecommendationChanged();
  return result;
}

export function recommendationFeedbackFromSong(
  song: Song,
  action: string,
  context = 'recommendation',
): RecommendationFeedback | null {
  if (!song.recommendationRequestId || !song.recommendationSource) return null;
  return {
    requestId: song.recommendationRequestId,
    song,
    action,
    recommendationSource: song.recommendationSource,
    context,
  };
}
