import { IpcError, isTauri, listenEvent, type UnlistenFn } from '../ipc';
import { getSongKey, type Song } from '../types';
import {
  getLatestRecommendationJob,
  refreshRecommendations,
  RECOMMENDATION_CHANGED_EVENT,
  type RecommendationJob,
} from './recommendation';
import { publishRecommendationJobProgress, updateRecommendationTaskProgress } from './recommendationTaskProgress';

export const fallbackPollIntervalMs = 10_000;
export const idlePollIntervalMs = 60_000;
export const busyRetryDelayMs = 500;
export const maxBusyRetries = 8;
export const isBusyError = (error: unknown): boolean => error instanceof IpcError && error.code === 'BUSY';

export interface RecommendationRuntimeState {
  job: RecommendationJob | null;
  loading: boolean;
  initializing: boolean;
  error: string;
}

const initialState: RecommendationRuntimeState = { job: null, loading: false, initializing: false, error: '' };
let state = initialState;
const subscribers = new Set<() => void>();
export const getRecommendationRuntimeState = (): RecommendationRuntimeState => state;
export const subscribeRecommendationRuntime = (listener: () => void): (() => void) => {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
};
const publish = (next: RecommendationRuntimeState): void => {
  state = next;
  subscribers.forEach((listener) => listener());
};

let activeReload: (() => void) | null = null;
let refreshPending: Promise<void> | null = null;

export const requestRecommendationRefresh = (): Promise<void> => {
  if (refreshPending) return refreshPending;
  refreshPending = refreshRecommendations().then(() => { activeReload?.(); })
    .finally(() => { refreshPending = null; });
  return refreshPending;
};

/** 反馈成功后仅移除可见项；反馈事务由调用方提交一次。 */
export const removeRecommendationSong = (song: Song): void => {
  if (!state.job) return;
  const key = getSongKey(song);
  publish({ ...state, job: { ...state.job, items: state.job.items.filter((item) => getSongKey(item.song) !== key) } });
};

export interface RecommendationRuntimeDependencies {
  getLatest: () => Promise<RecommendationJob | null>;
  listen: typeof listenEvent;
  native: () => boolean;
}
const defaultDependencies: RecommendationRuntimeDependencies = {
  getLatest: getLatestRecommendationJob, listen: listenEvent, native: isTauri,
};

/** 应用根级单一订阅；页面和标签只读快照，不创建自己的任务监听器。 */
export const startRecommendationRuntime = (
  dependencies: RecommendationRuntimeDependencies = defaultDependencies,
): (() => void) => {
  if (!dependencies.native()) return () => {};
  if (activeReload) return () => {};
  let disposed = false;
  let revision = 0;
  let running = false;
  let queued = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unlisteners: UnlistenFn[] = [];
  const schedule = (delay: number): void => {
    clearTimeout(timer);
    timer = setTimeout(reload, delay);
  };
  const apply = (job: RecommendationJob | null): void => {
    if (job) {
      publish({ job, loading: job.status === 'running' && job.items.length === 0, initializing: false, error: job.error ?? '' });
      publishRecommendationJobProgress(job);
    } else {
      publish({ ...initialState });
      updateRecommendationTaskProgress({
        local: { status: 'idle', detail: '等待推荐任务', updatedAt: 0 },
        cloud: { status: 'idle', detail: '等待推荐任务', updatedAt: 0 },
      });
    }
  };
  const run = async (): Promise<void> => {
    const request = revision;
    running = true;
    queued = false;
    try {
      const job = await dependencies.getLatest();
      if (disposed || request !== revision) return;
      retries = 0;
      apply(job);
      schedule(job?.status === 'running' || job?.status === 'waiting' ? fallbackPollIntervalMs : idlePollIntervalMs);
    } catch (error) {
      if (disposed || request !== revision) return;
      const initializing = isBusyError(error);
      publish({ ...state, loading: false, initializing, error: initializing ? '' : '推荐状态暂时无法读取' });
      if (initializing) {
        updateRecommendationTaskProgress({ local: { status: 'waiting', detail: '正在初始化', updatedAt: 0 } });
      } else {
        console.warn('读取推荐状态失败', error);
        updateRecommendationTaskProgress({
          local: { status: 'error', detail: '暂时无法读取状态' },
          cloud: { status: 'error', detail: '暂时无法读取状态' },
        });
      }
      schedule(initializing && retries++ < maxBusyRetries ? busyRetryDelayMs : fallbackPollIntervalMs);
    } finally {
      running = false;
      if (!disposed && queued) void run();
    }
  };
  function reload(): void {
    if (disposed) return;
    revision += 1;
    clearTimeout(timer);
    if (running) queued = true;
    else void run();
  }
  activeReload = reload;
  const changed = (event: Event): void => {
    if (event instanceof CustomEvent && event.detail === 'cleared') apply(null);
    reload();
  };
  window.addEventListener(RECOMMENDATION_CHANGED_EVENT, changed);
  reload();
  void Promise.allSettled([
    dependencies.listen('recommendation-ready', reload),
    dependencies.listen('recommendation-job-update', reload),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') console.warn('订阅推荐任务状态失败，使用轮询', result.reason);
      else if (disposed) result.value();
      else unlisteners.push(result.value);
    }
    reload();
  });
  return () => {
    if (disposed) return;
    disposed = true;
    revision += 1;
    clearTimeout(timer);
    unlisteners.forEach((unlisten) => unlisten());
    window.removeEventListener(RECOMMENDATION_CHANGED_EVENT, changed);
    if (activeReload === reload) activeReload = null;
  };
};
