import { useMemo, useSyncExternalStore } from 'react';
import { attachRecommendationMeta } from '../../../core/services/recommendation';
import {
  getRecommendationRuntimeState,
  removeRecommendationSong,
  requestRecommendationRefresh,
  subscribeRecommendationRuntime,
} from '../../../core/services/recommendationRuntime';

export function useRecommendationJob(
  active: boolean,
  showToast: (message: string, type: 'info' | 'warning') => void,
) {
  const state = useSyncExternalStore(subscribeRecommendationRuntime, getRecommendationRuntimeState);
  const songs = useMemo(() => state.job ? attachRecommendationMeta(state.job.items) : [], [state.job]);
  const refresh = async () => {
    try { await requestRecommendationRefresh(); }
    catch { showToast('暂时无法刷新推荐，请稍后重试', 'warning'); }
  };
  return { songs, loading: active && state.loading, initializing: active && state.initializing,
    error: active ? state.error : '', removeSong: removeRecommendationSong, refresh,
    running: state.job?.status === 'running', waiting: state.job?.status === 'waiting', disabled: state.job?.status === 'disabled' };
}
