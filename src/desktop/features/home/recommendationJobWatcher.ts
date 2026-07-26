import {
  IpcError,
  isTauri,
  listenEvent,
  type RecommendationJobUpdatePayload,
  type UnlistenFn,
} from '../../../core/ipc';
import {
  attachRecommendationMeta,
  getRecommendationJob,
  type RecommendationJob,
} from '../../../core/services/recommendation';
import {
  updateRecommendationTaskProgress,
  type RecommendationWorkerStatus,
} from '../../../core/services/recommendationTaskProgress';
import type { Song } from '../../../core/types';

/** 事件丢失时的低频兜底轮询间隔（契约 §4.3）。 */
export const fallbackPollIntervalMs = 10_000;
/** 兜底轮询次数上限，与旧实现同样约 60 秒后判定超时。 */
export const maxFallbackPolls = 6;
/** 推荐服务初始化期返回 BUSY 时的退避间隔与次数上限（契约 §7.7）。 */
export const busyRetryDelayMs = 500;
export const maxBusyRetries = 8;

export const isBusyError = (error: unknown): boolean =>
  error instanceof IpcError && error.code === 'BUSY';

export interface RecommendationJobDependencies {
  getJob: (jobId: string) => Promise<RecommendationJob | null>;
  listenJobUpdate: (
    handler: (payload: RecommendationJobUpdatePayload) => void,
  ) => Promise<UnlistenFn>;
  wait: (ms: number) => Promise<void>;
}

export interface RecommendationJobCallbacks {
  isCurrent: () => boolean;
  setSongs: (songs: Song[]) => void;
  setLoading: (loading: boolean) => void;
  showWarning: () => void;
}

const noopUnlisten: UnlistenFn = () => {};

export const waitMs = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

export const defaultJobDependencies: RecommendationJobDependencies = {
  getJob: getRecommendationJob,
  listenJobUpdate: (handler) =>
    isTauri()
      ? listenEvent('recommendation-job-update', handler)
      : Promise.resolve(noopUnlisten),
  wait: waitMs,
};

/**
 * Retries a command while the backend reports `BUSY`, i.e. while the
 * recommendation service is still opening its database in the background.
 */
export async function withBusyRetry<T>(
  run: () => Promise<T>,
  wait: (ms: number) => Promise<void>,
  onBusy?: () => void,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isBusyError(error) || attempt >= maxBusyRetries) throw error;
      onBusy?.();
      await wait(busyRetryDelayMs);
    }
  }
}

const publishCloudProgress = (status: RecommendationWorkerStatus, detail: string): void => {
  updateRecommendationTaskProgress({
    cloud: { status, detail, updatedAt: Date.now() },
  });
};

const cloudStatusFromPayload = (
  status: RecommendationJobUpdatePayload['status'],
): RecommendationWorkerStatus => (status === 'pending' ? 'running' : status);

/**
 * Follows a running recommendation job through the `recommendation-job-update`
 * event and pulls the full result once the job reaches a terminal state.
 * A low-frequency poll stays as a safety net for dropped events.
 * Returns a disposer that unsubscribes and stops the fallback loop.
 */
export function watchRecommendationJob(
  initialJob: RecommendationJob,
  callbacks: RecommendationJobCallbacks,
  dependencies: RecommendationJobDependencies = defaultJobDependencies,
): () => void {
  let stopped = false;
  let unlisten: UnlistenFn | null = null;

  const stop = (): void => {
    stopped = true;
    unlisten?.();
    unlisten = null;
  };

  const keepInitialItems = (detail: string): void => {
    callbacks.setLoading(false);
    if (initialJob.items.length > 0) {
      callbacks.setSongs(attachRecommendationMeta(initialJob.items));
    }
    publishCloudProgress('error', detail);
  };

  const applyTerminalJob = (job: RecommendationJob): void => {
    if (job.status === 'done') {
      callbacks.setSongs(attachRecommendationMeta(job.items));
      callbacks.setLoading(false);
      publishCloudProgress('done', `已刷新 ${job.items.length} 首推荐`);
      return;
    }
    if (job.items.length > 0) callbacks.setSongs(attachRecommendationMeta(job.items));
    callbacks.setLoading(false);
    publishCloudProgress('error', job.detail || '云端任务失败');
    if (job.error) callbacks.showWarning();
  };

  const refresh = async (): Promise<void> => {
    if (stopped) return;
    if (!callbacks.isCurrent()) {
      stop();
      return;
    }
    let job: RecommendationJob | null;
    try {
      job = await withBusyRetry(() => dependencies.getJob(initialJob.jobId), dependencies.wait, () =>
        publishCloudProgress('running', '推荐服务正在初始化，请稍候'),
      );
    } catch (error) {
      if (stopped) return;
      stop();
      if (!callbacks.isCurrent()) return;
      console.error(error);
      keepInitialItems('云端任务查询失败，保留当前推荐');
      callbacks.showWarning();
      return;
    }
    if (stopped || !job) return;
    if (!callbacks.isCurrent()) {
      stop();
      return;
    }
    if (job.status === 'running') {
      publishCloudProgress('running', job.detail);
      return;
    }
    stop();
    applyTerminalJob(job);
  };

  const runFallbackPolling = async (): Promise<void> => {
    for (let attempt = 0; attempt < maxFallbackPolls; attempt += 1) {
      await dependencies.wait(fallbackPollIntervalMs);
      if (stopped) return;
      await refresh();
      if (stopped) return;
    }
    stop();
    if (!callbacks.isCurrent()) return;
    keepInitialItems('云端任务超时，保留当前推荐');
  };

  void dependencies
    .listenJobUpdate((payload) => {
      if (stopped || payload.jobId !== initialJob.jobId) return;
      publishCloudProgress(
        cloudStatusFromPayload(payload.status),
        payload.detail ?? payload.stage ?? '云端任务进行中',
      );
      if (payload.status === 'done' || payload.status === 'error') void refresh();
    })
    .then((dispose) => {
      if (stopped) dispose();
      else unlisten = dispose;
    })
    .catch((error: unknown) => {
      console.warn('订阅推荐任务事件失败，仅使用兜底轮询', error);
    });

  void runFallbackPolling();

  return stop;
}
