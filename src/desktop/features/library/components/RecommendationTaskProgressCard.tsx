import { useEffect, useState } from 'react';
import {
  getRecommendationTaskProgress,
  subscribeRecommendationTaskProgress,
  type RecommendationTaskProgress,
  type RecommendationWorkerStatus,
} from '../../../../core/services/recommendationTaskProgress';

const statusText: Record<RecommendationWorkerStatus, string> = {
  idle: '空闲',
  running: '运行中',
  done: '已完成',
  error: '异常',
  disabled: '未启用',
};

const formatUpdatedAt = (value: number): string => {
  if (!value) return '尚未运行';
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export default function RecommendationTaskProgressCard() {
  const [progress, setProgress] = useState<RecommendationTaskProgress>(() => getRecommendationTaskProgress());

  useEffect(() => subscribeRecommendationTaskProgress(setProgress), []);

  return (
    <div className="settings-card task-progress-card glass-panel">
      <div className="task-progress-header">
        <div><h3>推荐状态</h3><p>看看为你挑选音乐的进展。</p></div>
      </div>
      <div className="task-progress-list">
        {[progress.local, progress.cloud].map((worker, index) => (
          <div className={`task-progress-row ${worker.status}`} key={worker.label}>
            <span className="task-progress-dot" />
            <div>
              <strong>{index === 0 ? '本地推荐' : 'AI 精选'}</strong>
              <p title={worker.detail}>{worker.detail}</p>
            </div>
            <em>{statusText[worker.status]}</em>
            <small>{formatUpdatedAt(worker.updatedAt)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
