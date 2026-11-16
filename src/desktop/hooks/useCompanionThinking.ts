import { useSyncExternalStore } from 'react';
import { getRecommendationRuntimeState, subscribeRecommendationRuntime } from '../../core/services/recommendationRuntime';

/** 桌宠、推荐列表和设置卡共用同一快照，不额外订阅原生事件或读取任务。 */
export function useCompanionThinking(promptBusy: boolean): boolean {
  const { job } = useSyncExternalStore(subscribeRecommendationRuntime, getRecommendationRuntimeState);
  return promptBusy || job?.status === 'running';
}
