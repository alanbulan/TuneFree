import type { RecommendationJob } from './recommendation';

export type RecommendationWorkerStatus = 'idle' | 'waiting' | 'running' | 'done' | 'error' | 'cancelled' | 'disabled';

export interface RecommendationWorkerProgress {
  label: string;
  status: RecommendationWorkerStatus;
  detail: string;
  updatedAt: number;
}

export interface RecommendationTaskProgress {
  local: RecommendationWorkerProgress;
  cloud: RecommendationWorkerProgress;
}

type RecommendationTaskProgressListener = (progress: RecommendationTaskProgress) => void;
type RecommendationTaskProgressPatch = {
  local?: Partial<RecommendationWorkerProgress>;
  cloud?: Partial<RecommendationWorkerProgress>;
};

const createDefaultProgress = (): RecommendationTaskProgress => ({
  local: {
    label: '本地推荐',
    status: 'idle',
    detail: '等待推荐任务',
    updatedAt: 0,
  },
  cloud: {
    label: 'AI 精选',
    status: 'idle',
    detail: '等待推荐任务',
    updatedAt: 0,
  },
});

let currentProgress = createDefaultProgress();
const listeners = new Set<RecommendationTaskProgressListener>();

export const getRecommendationTaskProgress = (): RecommendationTaskProgress => currentProgress;

export const subscribeRecommendationTaskProgress = (
  listener: RecommendationTaskProgressListener,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const updateRecommendationTaskProgress = (
  next:
    | RecommendationTaskProgressPatch
    | ((prev: RecommendationTaskProgress) => RecommendationTaskProgressPatch),
): void => {
  const patch = typeof next === 'function' ? next(currentProgress) : next;
  currentProgress = {
    local: patch.local ? { ...currentProgress.local, ...patch.local } : currentProgress.local,
    cloud: patch.cloud ? { ...currentProgress.cloud, ...patch.cloud } : currentProgress.cloud,
  };
  listeners.forEach((listener) => listener(currentProgress));
};

/** 后台时间是任务状态的事实来源；读取界面不刷新任务时间。 */
export const publishRecommendationJobProgress = (job: RecommendationJob): void => {
  const localStatus = job.status === 'disabled' ? 'disabled'
    : job.localUpdatedAt > 0 ? 'done' : job.status === 'error' ? 'error' : job.status;
  updateRecommendationTaskProgress({
    local: {
      status: localStatus,
      detail: localStatus === 'done' ? `${job.localCount} 首本地候选` : job.detail,
      updatedAt: job.localUpdatedAt,
    },
    cloud: {
      status: job.cloudEnabled ? job.status : 'disabled',
      detail: job.cloudEnabled ? job.detail : '未启用',
      updatedAt: job.cloudEnabled ? job.status === 'done' ? job.resultUpdatedAt : job.updatedAt : 0,
    },
  });
};
