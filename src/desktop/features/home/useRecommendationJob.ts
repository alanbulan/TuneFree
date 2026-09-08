import { isTauri, listenEvent } from '../../../core/ipc';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  attachRecommendationMeta,
  dismissRecommendation,
  getLatestRecommendationJob,
} from '../../../core/services/recommendation';
import { updateRecommendationTaskProgress } from '../../../core/services/recommendationTaskProgress';
import type { Song } from '../../../core/types';
import {
  isBusyError,
  waitMs,
  watchRecommendationJob,
  withBusyRetry,
} from './recommendationJobWatcher';

export function useRecommendationJob(
  active: boolean,
  showToast: (message: string, type: 'info' | 'warning') => void,
) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const disposeRef = useRef<(() => void) | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestId === requestIdRef.current;
    loadAbortRef.current?.abort();
    const cancellation = new AbortController();
    loadAbortRef.current = cancellation;
    disposeRef.current?.();
    disposeRef.current = null;
    const startedAt = Date.now();
    setError('');
    setInitializing(false);
    setLoading(true);
    updateRecommendationTaskProgress({
      local: { label: '本地推荐', status: 'running', detail: '正在读取推荐歌单', updatedAt: startedAt },
      cloud: { label: 'AI 精选', status: 'idle', detail: '等待 AI 推荐状态', updatedAt: startedAt },
    });

    try {
      const job = await withBusyRetry(() => {
        cancellation.signal.throwIfAborted();
        return getLatestRecommendationJob();
      }, (ms) => waitMs(ms, cancellation.signal), () => {
        if (!isCurrent()) return;
        setInitializing(true);
        updateRecommendationTaskProgress({
          local: { status: 'running', detail: '推荐服务正在初始化，请稍候', updatedAt: Date.now() },
        });
      });
      if (!isCurrent()) return;
      activeJobIdRef.current = job?.jobId ?? null;
      setInitializing(false);
      if (!job) {
        setSongs([]);
        setError('推荐任务正在准备；启用推荐后会自动更新。');
        setLoading(false);
        updateRecommendationTaskProgress({
          local: { status: 'idle', detail: '还没有推荐记录', updatedAt: Date.now() },
          cloud: { status: 'idle', detail: '还没有推荐记录', updatedAt: Date.now() },
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
      disposeRef.current = watchRecommendationJob(job, {
        isCurrent,
        setSongs,
        setLoading,
        showWarning: () => showToast('云端发现与重排暂不可用，已保留当前推荐', 'warning'),
      });
    } catch (cause) {
      if (!isCurrent()) return;
      console.error(cause);
      setSongs([]);
      setInitializing(false);
      setLoading(false);
      const busy = isBusyError(cause);
      setError(busy ? '推荐服务正在初始化，请稍后重试。' : '推荐暂不可用。');
      updateRecommendationTaskProgress({
        local: {
          status: busy ? 'running' : 'error',
          detail: busy ? '推荐服务正在初始化，请稍候' : '本地推荐任务失败',
          updatedAt: Date.now(),
        },
        cloud: { status: 'disabled', detail: '未启动云端任务', updatedAt: Date.now() },
      });
    }
  }, [showToast]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const reload = () => { if (!disposed) void load(); };
    if (isTauri()) {
      void Promise.allSettled([
        listenEvent('recommendation-ready', reload),
        listenEvent('recommendation-job-update', (payload) => {
          if (payload.status === 'running' && payload.jobId !== activeJobIdRef.current) {
            activeJobIdRef.current = payload.jobId;
            reload();
          }
        }),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') console.warn('订阅推荐状态失败', result.reason);
          else if (disposed) result.value();
          else unlisteners.push(result.value);
        }
        reload();
      });
    } else reload();
    return () => {
      disposed = true;
      requestIdRef.current += 1;
      loadAbortRef.current?.abort();
      unlisteners.forEach((unlisten) => unlisten());
      disposeRef.current?.();
      disposeRef.current = null;
    };
  }, [active, load]);

  const removeSong = useCallback((song: Song) => {
    setSongs((current) => current.filter((item) => item.id !== song.id || item.source !== song.source));
    void dismissRecommendation(song, 'home_dismiss').catch((cause: unknown) => {
      console.warn('提交「不感兴趣」反馈失败', cause);
    });
  }, []);

  return { songs, loading, initializing, error, removeSong };
}
