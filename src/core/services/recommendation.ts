import { invoke } from '@tauri-apps/api/core';
import type { Song, Playlist } from '../types';
import { getSongKey } from '../types';

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const isLocalRecommendationEnabled = (): boolean =>
  typeof window === 'undefined' ||
  localStorage.getItem('tunefree_local_recommendation_enabled') !== 'false';

export interface RecommendationEvent {
  eventType: string;
  song?: Song | null;
  positionSeconds?: number;
  durationSeconds?: number;
  quality?: string;
  context?: string;
}

export interface RecommendationOptions {
  limit?: number;
  seed?: Song;
  context?: string;
  useLlm?: boolean;
}

export interface RecommendationItem {
  song: Song;
  score: number;
  reasons: string[];
  recommendationSource: string;
  requestId: string;
}

export interface LibrarySnapshot {
  favorites: Song[];
  playlists: Playlist[];
  queue: Song[];
  currentSong?: Song | null;
}

export interface RecommendationFeedback {
  requestId: string;
  trackKey: string;
  action: string;
  recommendationSource: string;
}

export interface LlmConfigView {
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

const toRecommendedSong = (item: RecommendationItem): Song => ({
  ...item.song,
  recommendationReasons: item.reasons,
  recommendationSource: item.recommendationSource,
  recommendationRequestId: item.requestId,
  recommendationScore: item.score,
});

export const attachRecommendationMeta = (items: RecommendationItem[]): Song[] =>
  items.map(toRecommendedSong);

export async function logRecommendationEvent(event: RecommendationEvent): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invoke('log_recommendation_event', { event });
}

export async function syncRecommendationLibrary(snapshot: LibrarySnapshot): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invoke('sync_recommendation_library', { snapshot });
}

export async function getHomeRecommendations(
  options: RecommendationOptions = {},
): Promise<RecommendationItem[]> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return [];
  return invoke<RecommendationItem[]>('get_home_recommendations', {
    query: {
      limit: options.limit,
      seed: options.seed,
      context: options.context,
      useLlm: false,
    },
  });
}

export async function getLlmEnhancedRecommendations(
  options: RecommendationOptions = {},
): Promise<RecommendationItem[]> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return [];
  return invoke<RecommendationItem[]>('get_llm_enhanced_recommendations', {
    query: {
      limit: options.limit,
      seed: options.seed,
      context: options.context,
      useLlm: true,
    },
  });
}

export async function getSimilarSongs(
  song: Song,
  options: RecommendationOptions = {},
): Promise<RecommendationItem[]> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return [];
  return invoke<RecommendationItem[]>('get_similar_songs', {
    song,
    limit: options.limit,
    useLlm: options.useLlm,
  });
}

export async function dismissRecommendation(song: Song, reason?: string): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invoke('dismiss_recommendation', { song, reason });
}

export async function saveRecommendationFeedback(
  feedback: RecommendationFeedback,
): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invoke('save_recommendation_feedback', { feedback });
}

export async function rebuildRecommendationIndex(): Promise<void> {
  if (!isTauri() || !isLocalRecommendationEnabled()) return;
  await invoke('rebuild_recommendation_index');
}

export async function getLlmConfig(): Promise<LlmConfigView> {
  if (!isTauri()) {
    return {
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
  return invoke<LlmConfigView>('get_llm_config');
}

export async function saveLlmConfig(config: LlmConfigInput): Promise<void> {
  if (!isTauri()) return;
  await invoke('save_llm_config', { config });
}

export async function testLlmProvider(): Promise<LlmProviderTestResult> {
  if (!isTauri()) {
    return {
      ok: false,
      status: 'browser_preview',
      supportsJsonObject: false,
      error: '当前环境不是 Tauri 桌面端',
    };
  }
  return invoke<LlmProviderTestResult>('test_llm_provider');
}

export async function clearRecommendationData(): Promise<RecommendationMaintenanceStats> {
  if (!isTauri()) return { databaseSizeBytes: 0, llmCacheEntries: 0 };
  return invoke<RecommendationMaintenanceStats>('clear_recommendation_data');
}

export function recommendationFeedbackFromSong(
  song: Song,
  action: string,
): RecommendationFeedback | null {
  if (!song.recommendationRequestId || !song.recommendationSource) return null;
  return {
    requestId: song.recommendationRequestId,
    trackKey: getSongKey(song),
    action,
    recommendationSource: song.recommendationSource,
  };
}
