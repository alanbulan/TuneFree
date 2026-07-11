import { useCallback, useEffect, useRef, useState } from 'react';
import {
  attachRecommendationMeta,
  getLatestRecommendationJob,
  getRecommendationJob,
  type RecommendationJob,
} from '../../../core/services/recommendation';
import { updateRecommendationTaskProgress } from '../../../core/services/recommendationTaskProgress';
import type { Song } from '../../../core/types';

const pollIntervalMs = 1200;
const maxPollAttempts = 50;

export interface RecommendationJobDependencies {
  getLatestJob: typeof getLatestRecommendationJob;
  getJob: typeof getRecommendationJob;
  wait: (ms: number) => Promise<void>;
}

const defaultDependencies: RecommendationJobDependencies = {
  getLatestJob: getLatestRecommendationJob,
  getJob: getRecommendationJob,
  wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
};

export interface RecommendationJobCallbacks {
  isCurrent: () => boolean;
  setSongs: (songs: Song[]) => void;
  setLoading: (loading: boolean) => void;
  showWarning: () => void;
}

export async function pollRecommendationJob(
  initialJob: RecommendationJob,
  callbacks: RecommendationJobCallbacks,
  dependencies: RecommendationJobDependencies = defaultDependencies,
): Promise<void> {
  try {
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      await dependencies.wait(pollIntervalMs);
      if (!callbacks.isCurrent()) return;
      const job = await dependencies.getJob(initialJob.jobId);
      if (!callbacks.isCurrent() || !job) return;
      updateRecommendationTaskProgress({
        cloud: { status: job.status, detail: job.detail, updatedAt: Date.now() },
      });
      if (job.status === 'done') {
        callbacks.setSongs(attachRecommendationMeta(job.items));
        callbacks.setLoading(false);
        updateRecommendationTaskProgress({
          cloud: {
            status: 'done',
            detail: `已刷新 ${job.items.length} 首推荐`,
            updatedAt: Date.now(),
          },
        });
        return;
      }
      if (job.status === 'error') {
        if (job.items.length > 0) callbacks.setSongs(attachRecommendationMeta(job.items));
        callbacks.setLoading(false);
        if (job.error) callbacks.showWarning();
        return;
      }
    }
    callbacks.setLoading(false);
    if (initialJob.items.length > 0) {
      callbacks.setSongs(attachRecommendationMeta(initialJob.items));
    }
    updateRecommendationTaskProgress({
      cloud: { status: 'error', detail: '云端任务超时，保留当前推荐', updatedAt: Date.now() },
    });
  } catch (error) {
    if (!callbacks.isCurrent()) return;
    console.error(error);
    callbacks.setLoading(false);
    if (initialJob.items.length > 0) {
      callbacks.setSongs(attachRecommendationMeta(initialJob.items));
    }
    updateRecommendationTaskProgress({
      cloud: { status: 'error', detail: '云端任务查询失败，保留当前推荐', updatedAt: Date.now() },
    });
    callbacks.showWarning();
  }
}

export function useRecommendationJob(active: boolean, showToast: (message: string, type: 'info' | 'warning') => void) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestId === requestIdRef.current;
    const startedAt = Date.now();
    setError('');
    setLoading(true);
    updateRecommendationTaskProgress({
      local: { label: '本地 worker', status: 'running', detail: '正在读取启动预热候选', updatedAt: startedAt },
      cloud: { label: '云端 worker', status: 'idle', detail: '等待启动预热任务状态', updatedAt: startedAt },
    });

    try {
      const job = await defaultDependencies.getLatestJob();
      if (!isCurrent()) return;
      if (!job) {
        setSongs([]);
        setError('智能推荐任务尚未启动，请在设置中启用推荐后重启应用。');
        setLoading(false);
        updateRecommendationTaskProgress({
          local: { status: 'idle', detail: '未发现启动预热任务', updatedAt: Date.now() },
          cloud: { status: 'idle', detail: '未发现启动预热任务', updatedAt: Date.now() },
        });
        return;
      }

      const hasItems = job.items.length > 0;
      const cloudRunning = job.status === 'running';
      const hasCloudItems = job.items.some((item) => item.recommendationSource === 'hybrid');
      const showItems = job.status !== 'running' || job.stage === 'local_only' || hasCloudItems;
      setSongs(showItems ? attachRecommendationMeta(job.items) : []);
      setLoading(cloudRunning && !hasCloudItems);
      updateRecommendationTaskProgress({
        local: {
          status: 'done',
          detail: hasCloudItems
            ? `已读取 ${job.items.length} 首最近一次云端结果`
            : hasItems ? `已生成 ${job.items.length} 首候选` : cloudRunning ? '本地候选为空，等待云端发现' : job.detail,
          updatedAt: Date.now(),
        },
        cloud: { status: job.stage === 'local_only' ? 'disabled' : job.status, detail: job.detail, updatedAt: Date.now() },
      });
      if (!hasItems && !cloudRunning) {
        showToast('多播放或收藏几首歌后，推荐会更准确', 'info');
        return;
      }
      if (job.status === 'error') {
        if (job.error) showToast('云端发现与重排暂不可用，已保留当前推荐', 'warning');
        return;
      }
      if (job.status === 'done') return;
      void pollRecommendationJob(job, {
        isCurrent,
        setSongs,
        setLoading,
        showWarning: () => showToast('云端发现与重排暂不可用，已保留当前推荐', 'warning'),
      });
    } catch (cause) {
      if (!isCurrent()) return;
      console.error(cause);
      setSongs([]);
      setError('推荐暂不可用。');
      setLoading(false);
      updateRecommendationTaskProgress({
        local: { status: 'error', detail: '本地推荐任务失败', updatedAt: Date.now() },
        cloud: { status: 'disabled', detail: '未启动云端任务', updatedAt: Date.now() },
      });
    }
  }, [showToast]);

  useEffect(() => {
    if (active) void load();
    return () => { requestIdRef.current += 1; };
  }, [active, load]);

  const removeSong = useCallback((song: Song) => {
    setSongs((current) => current.filter((item) => item.id !== song.id || item.source !== song.source));
  }, []);

  return { songs, loading, error, removeSong };
}
