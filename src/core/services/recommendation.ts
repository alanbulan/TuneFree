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
    ...(pic ? { pic } : {}),
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
  await invokeCommand('log_recommendation_event', { event });
}

export async function syncRecommendationLibrary(snapshot: LibrarySnapshot): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invokeCommand('sync_recommendation_library', { snapshot });
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
    song,
    limit: options.limit,
  });
}

export async function dismissRecommendation(song: Song, reason?: string): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invokeCommand('dismiss_recommendation', { song, reason });
}

export async function saveRecommendationFeedback(
  feedback: RecommendationFeedback,
): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invokeCommand('save_recommendation_feedback', { feedback });
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
  return invokeCommand('get_llm_config');
}

export async function saveLlmConfig(config: LlmConfigInput): Promise<void> {
  if (!isTauri()) return;
  await invokeCommand('save_llm_config', { config });
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
  return invokeCommand('clear_recommendation_data');
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
