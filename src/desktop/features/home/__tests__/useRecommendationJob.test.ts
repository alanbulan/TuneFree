import { describe, expect, it, vi } from 'vitest';
import type { RecommendationJob } from '../../../../core/services/recommendation';
import { pollRecommendationJob, type RecommendationJobDependencies } from '../useRecommendationJob';

const item = {
  song: { id: 'song-1', name: 'Song', artist: 'Artist', album: 'Album', source: 'netease' },
  score: 0.8,
  reasons: ['reason'],
  recommendationSource: 'hybrid',
  requestId: 'request-1',
};

const createJob = (overrides: Partial<RecommendationJob> = {}): RecommendationJob => ({
  jobId: 'job-1',
  status: 'running',
  stage: 'cloud_rerank',
  detail: 'running',
  items: [],
  updatedAt: 1,
  ...overrides,
});

const createDependencies = (job: RecommendationJob | null): RecommendationJobDependencies => ({
  getLatestJob: vi.fn(),
  getJob: vi.fn().mockResolvedValue(job),
  wait: vi.fn().mockResolvedValue(undefined),
});

describe('pollRecommendationJob', () => {
  it('publishes completed cloud items and stops loading', async () => {
    const setSongs = vi.fn();
    const setLoading = vi.fn();
    await pollRecommendationJob(
      createJob(),
      { isCurrent: () => true, setSongs, setLoading, showWarning: vi.fn() },
      createDependencies(createJob({ status: 'done', stage: 'done', items: [item] })),
    );

    expect(setSongs).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'song-1',
        recommendationSource: 'hybrid',
        recommendationRequestId: 'request-1',
      }),
    ]);
    expect(setLoading).toHaveBeenCalledWith(false);
  });

  it('keeps initial items and warns when polling fails', async () => {
    const setSongs = vi.fn();
    const showWarning = vi.fn();
    const dependencies = createDependencies(null);
    vi.mocked(dependencies.getJob).mockRejectedValue(new Error('network'));

    await pollRecommendationJob(
      createJob({ items: [item] }),
      { isCurrent: () => true, setSongs, setLoading: vi.fn(), showWarning },
      dependencies,
    );

    expect(setSongs).toHaveBeenCalledWith([expect.objectContaining({ id: 'song-1' })]);
    expect(showWarning).toHaveBeenCalledOnce();
  });

  it('does not query a job after the request becomes stale', async () => {
    const dependencies = createDependencies(createJob({ status: 'done' }));
    await pollRecommendationJob(
      createJob(),
      { isCurrent: () => false, setSongs: vi.fn(), setLoading: vi.fn(), showWarning: vi.fn() },
      dependencies,
    );

    expect(dependencies.getJob).not.toHaveBeenCalled();
  });
});
