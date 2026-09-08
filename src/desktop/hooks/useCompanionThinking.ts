import { useEffect, useState } from 'react';
import { isTauri, listenEvent } from '../../core/ipc';
import { getLatestRecommendationJob } from '../../core/services/recommendation';

/** 订阅真实推荐任务，切换页面后桌宠仍能反映后端状态。 */
export function useCompanionThinking(promptBusy: boolean): boolean {
  const [recommendationBusy, setRecommendationBusy] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let revision = 0;
    const unlisteners: Array<() => void> = [];
    const refresh = async () => {
      if (disposed) return;
      const version = ++revision;
      try {
        const job = await getLatestRecommendationJob();
        if (!disposed && version === revision) setRecommendationBusy(job?.status === 'running');
      } catch {
        // 初始化完成后 recommendation-ready 会补读，桌宠不额外触发推荐任务。
      }
    };
    void Promise.allSettled([
      listenEvent('recommendation-ready', () => { void refresh(); }),
      listenEvent('recommendation-job-update', (job) => {
        if (disposed) return;
        revision += 1;
        setRecommendationBusy(job.status === 'running' || job.status === 'pending');
      }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (disposed) result.value();
          else unlisteners.push(result.value);
        } else console.warn('无法订阅音乐伙伴的推荐状态', result.reason);
      }
      if (!disposed) void refresh();
    });
    return () => {
      disposed = true;
      revision += 1;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);
  return promptBusy || recommendationBusy;
}
