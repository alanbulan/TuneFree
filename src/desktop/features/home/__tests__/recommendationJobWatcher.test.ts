import { describe, expect, it, vi } from 'vitest';
import { IpcError } from '../../../../core/ipc';
import type { RecommendationJob } from '../../../../core/services/recommendation';
import {
  maxBusyRetries,
  watchRecommendationJob,
  withBusyRetry,
  type RecommendationJobDependencies,
} from '../recommendationJobWatcher';

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

interface Harness {
  dependencies: RecommendationJobDependencies;
  emit: (payload: {
    jobId: string;
    status: 'pending' | 'running' | 'done' | 'error';
    stage: string | null;
    detail: string | null;
  }) => void;
  unlisten: ReturnType<typeof vi.fn>;
}

const createHarness = (job: RecommendationJob | null): Harness => {
  const unlisten = vi.fn();
  let handler: Harness['emit'] = () => {};
  return {
    unlisten,
    emit: (payload) => handler(payload),
    dependencies: {
      getJob: vi.fn().mockResolvedValue(job),
      listenJobUpdate: vi.fn().mockImplementation((next: Harness['emit']) => {
        handler = next;
        return Promise.resolve(unlisten);
      }),
      // 兜底轮询永不推进，确保断言只反映事件推送路径。
      wait: vi.fn().mockImplementation(() => new Promise<void>(() => {})),
    },
  };
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('watchRecommendationJob', () => {
  it('pulls the full job once the update event reports done', async () => {
    const setSongs = vi.fn();
    const setLoading = vi.fn();
    const harness = createHarness(createJob({ status: 'done', stage: 'done', items: [item] }));

    watchRecommendationJob(
      createJob(),
      { isCurrent: () => true, setSongs, setLoading, showWarning: vi.fn() },
      harness.dependencies,
    );
    await flush();
    harness.emit({ jobId: 'job-1', status: 'done', stage: 'done', detail: null });
    await flush();

    expect(harness.dependencies.getJob).toHaveBeenCalledWith('job-1');
    expect(setSongs).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'song-1',
        recommendationSource: 'hybrid',
        recommendationRequestId: 'request-1',
      }),
    ]);
    expect(setLoading).toHaveBeenCalledWith(false);
    expect(harness.unlisten).toHaveBeenCalled();
  });

  it('ignores events belonging to another job', async () => {
    const harness = createHarness(createJob({ status: 'done' }));
    watchRecommendationJob(
      createJob(),
      { isCurrent: () => true, setSongs: vi.fn(), setLoading: vi.fn(), showWarning: vi.fn() },
      harness.dependencies,
    );
    await flush();
    harness.emit({ jobId: 'other-job', status: 'done', stage: null, detail: null });
    await flush();

    expect(harness.dependencies.getJob).not.toHaveBeenCalled();
  });

  it('keeps initial items and warns when the pull fails', async () => {
    const setSongs = vi.fn();
    const showWarning = vi.fn();
    const harness = createHarness(null);
    vi.mocked(harness.dependencies.getJob).mockRejectedValue(new Error('network'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    watchRecommendationJob(
      createJob({ items: [item] }),
      { isCurrent: () => true, setSongs, setLoading: vi.fn(), showWarning },
      harness.dependencies,
    );
    await flush();
    harness.emit({ jobId: 'job-1', status: 'error', stage: 'error', detail: null });
    await flush();

    expect(setSongs).toHaveBeenCalledWith([expect.objectContaining({ id: 'song-1' })]);
    expect(showWarning).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('does not query a job after the request becomes stale', async () => {
    const harness = createHarness(createJob({ status: 'done' }));
    watchRecommendationJob(
      createJob(),
      { isCurrent: () => false, setSongs: vi.fn(), setLoading: vi.fn(), showWarning: vi.fn() },
      harness.dependencies,
    );
    await flush();
    harness.emit({ jobId: 'job-1', status: 'done', stage: 'done', detail: null });
    await flush();

    expect(harness.dependencies.getJob).not.toHaveBeenCalled();
  });

  it('stops polling and unsubscribes when disposed', async () => {
    const harness = createHarness(createJob({ status: 'done' }));
    const dispose = watchRecommendationJob(
      createJob(),
      { isCurrent: () => true, setSongs: vi.fn(), setLoading: vi.fn(), showWarning: vi.fn() },
      harness.dependencies,
    );
    await flush();
    dispose();
    harness.emit({ jobId: 'job-1', status: 'done', stage: 'done', detail: null });
    await flush();

    expect(harness.unlisten).toHaveBeenCalledOnce();
    expect(harness.dependencies.getJob).not.toHaveBeenCalled();
  });
});

describe('withBusyRetry', () => {
  it('retries while the service reports BUSY and then resolves', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const onBusy = vi.fn();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new IpcError('BUSY', '推荐服务正在初始化，请稍候'))
      .mockResolvedValue('ok');

    await expect(withBusyRetry(run, wait, onBusy)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
    expect(onBusy).toHaveBeenCalledOnce();
  });

  it('gives up after the retry budget and rethrows', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockRejectedValue(new IpcError('BUSY', '推荐服务正在初始化，请稍候'));

    await expect(withBusyRetry(run, wait)).rejects.toBeInstanceOf(IpcError);
    expect(run).toHaveBeenCalledTimes(maxBusyRetries + 1);
  });

  it('rethrows non-BUSY errors immediately', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockRejectedValue(new IpcError('NETWORK', '网络异常'));

    await expect(withBusyRetry(run, wait)).rejects.toBeInstanceOf(IpcError);
    expect(run).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });
});
