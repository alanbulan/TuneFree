import type { RecommendationJob } from '../services/recommendation';

export const recommendationSong = { id: 'song', name: '推荐歌曲', artist: '歌手', album: '', source: 'qq' };
export const recommendationItem = { song: recommendationSong, score: 0.9, reasons: ['喜欢的风格'],
  recommendationSource: 'hybrid', requestId: 'request' };

export const recommendationJob = (patch: Partial<RecommendationJob> = {}): RecommendationJob => ({
  jobId: 'job', status: 'done', stage: 'done', detail: '推荐已更新', items: [recommendationItem],
  error: null, updatedAt: 2000, deadlineAt: null, localCount: 1, localUpdatedAt: 1000,
  cloudEnabled: true, resultUpdatedAt: 1500, nextRefreshAt: null, ...patch,
});
