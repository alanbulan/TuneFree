import { useEffect, useState } from 'react';
import { isTauri, listenEvent } from '../../core/ipc';
import { getLatestRecommendationJob } from '../../core/services/recommendation';

/** 订阅真实推荐任务，切换页面后桌宠仍能反映后端状态。 */
export function useCompanionThinking(promptBusy: boolean): boolean {
  const [recommendationBusy, setRecommendationBusy] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    const lifecycle = { disposed: false, revision: 0 };
    const unlisteners: Array<() => void> = [];
    const refresh = async () => {
      if (lifecycle.disposed) return;
      const version = ++lifecycle.revision;
      try {
        const job = await getLatestRecommendationJob();
        if (!lifecycle.disposed && version === lifecycle.revision) setRecommendationBusy(job?.status === 'running');
      } catch {
        // 初始化完成后 recommendation-ready 会补读，桌宠不额外触发推荐任务。
      }
    };
    void Promise.allSettled([
      listenEvent('recommendation-ready', () => { void refresh(); }),
      listenEvent('recommendation-job-update', (job) => {
        if (lifecycle.disposed) return;
        lifecycle.revision += 1;
        setRecommendationBusy(job.status === 'running' || job.status === 'pending');
      }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (lifecycle.disposed) result.value();
          else unlisteners.push(result.value);
        } else console.warn('无法订阅音乐伙伴的推荐状态', result.reason);
      }
      if (!lifecycle.disposed) void refresh();
    });
    return () => {
      lifecycle.disposed = true;
      lifecycle.revision += 1;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);
  return promptBusy || recommendationBusy;
}
