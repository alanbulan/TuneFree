export type RecommendationWorkerStatus = 'idle' | 'running' | 'done' | 'error' | 'disabled';

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

const now = () => Date.now();

const createDefaultProgress = (): RecommendationTaskProgress => ({
  local: {
    label: '本地 worker',
    status: 'idle',
    detail: '等待推荐任务',
    updatedAt: now(),
  },
  cloud: {
    label: '云端 worker',
    status: 'idle',
    detail: '等待推荐任务',
    updatedAt: now(),
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
