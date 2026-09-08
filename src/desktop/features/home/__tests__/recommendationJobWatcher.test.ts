import { afterEach, describe, expect, it, vi } from 'vitest';
import { IpcError } from '../../../../core/ipc';
import { deferred } from '../../../../core/__tests__/deferred';
import type { RecommendationJob } from '../../../../core/services/recommendation';
import {
  maxBusyRetries,
  defaultJobDependencies,
  watchRecommendationJob,
  withBusyRetry,
  waitMs,
  type RecommendationJobDependencies,
} from '../recommendationJobWatcher';

const native = vi.hoisted(() => ({ enabled: true, listen: vi.fn() }));
vi.mock('../../../../core/ipc', async (original) => ({ ...await original<typeof import('../../../../core/ipc')>(),
  isTauri: () => native.enabled, listenEvent: native.listen }));

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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('watchRecommendationJob', () => {
  it('默认事件依赖在原生注册，浏览器环境返回可释放的空订阅', async () => {
    native.enabled = false;
    const dispose = await defaultJobDependencies.listenJobUpdate(vi.fn());
    expect(() => dispose()).not.toThrow();
    native.enabled = true;
    const nativeDispose = vi.fn(); native.listen.mockResolvedValueOnce(nativeDispose);
    const callback = vi.fn();
    expect(await defaultJobDependencies.listenJobUpdate(callback)).toBe(nativeDispose);
    expect(native.listen).toHaveBeenCalledWith('recommendation-job-update', callback);
  });

  it('云端失败返回已有推荐时保留列表，结束加载并提示失败', async () => {
    const harness = createHarness(createJob({ status: 'error', detail: '', error: '模型失败', items: [item] }));
    const setSongs = vi.fn(), setLoading = vi.fn(), showWarning = vi.fn();
    watchRecommendationJob(createJob(), { isCurrent: () => true, setSongs, setLoading, showWarning }, harness.dependencies);
    await flush();
    harness.emit({ jobId: 'job-1', status: 'error', stage: null, detail: null });
    await flush();
    expect(setSongs).toHaveBeenCalledWith([expect.objectContaining({ id: 'song-1' })]);
    expect(setLoading).toHaveBeenCalledWith(false); expect(showWarning).toHaveBeenCalledOnce();
    expect(harness.unlisten).toHaveBeenCalledOnce();
  });

  it('查询等待中请求失效时丢弃结果并释放订阅', async () => {
    const harness = createHarness(null), pending = deferred<RecommendationJob | null>();
    vi.mocked(harness.dependencies.getJob).mockReturnValueOnce(pending.promise);
    let current = true; const setSongs = vi.fn();
    watchRecommendationJob(createJob(), { isCurrent: () => current, setSongs, setLoading: vi.fn(), showWarning: vi.fn() }, harness.dependencies);
    await flush(); harness.emit({ jobId: 'job-1', status: 'done', stage: null, detail: null });
    current = false; pending.resolve(createJob({ status: 'done', items: [item] })); await flush();
    expect(setSongs).not.toHaveBeenCalled(); expect(harness.unlisten).toHaveBeenCalledOnce();
  });

  it('事件订阅失败后仍能通过轮询完成任务', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const harness = createHarness(createJob({ status: 'done', items: [item] }));
    harness.dependencies.wait = waitMs;
    vi.mocked(harness.dependencies.listenJobUpdate).mockRejectedValueOnce(new Error('事件不可用'));
    const setSongs = vi.fn();
    watchRecommendationJob(createJob(), { isCurrent: () => true, setSongs, setLoading: vi.fn(), showWarning: vi.fn() }, harness.dependencies);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(warn).toHaveBeenCalledOnce();
    expect(setSongs).toHaveBeenCalledWith([expect.objectContaining({ id: 'song-1' })]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues past 60 seconds until the backend deadline and releases timers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const harness = createHarness(createJob());
    harness.dependencies.wait = waitMs;
    const setLoading = vi.fn();
    watchRecommendationJob(createJob({ deadlineAt: 120_000 }), {
      isCurrent: () => true, setSongs: vi.fn(), setLoading, showWarning: vi.fn(),
    }, harness.dependencies);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(harness.dependencies.getJob).toHaveBeenCalledTimes(7);
    expect(setLoading).not.toHaveBeenCalled();
    expect(harness.unlisten).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(setLoading).toHaveBeenCalledWith(false);
    expect(harness.unlisten).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposing while waiting or retrying BUSY releases the pending timer', async () => {
    vi.useFakeTimers();
    const harness = createHarness(createJob());
    harness.dependencies.wait = waitMs;
    vi.mocked(harness.dependencies.getJob).mockRejectedValue(new IpcError('BUSY', '初始化'));
    const dispose = watchRecommendationJob(createJob(), {
      isCurrent: () => true, setSongs: vi.fn(), setLoading: vi.fn(), showWarning: vi.fn(),
    }, harness.dependencies);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.dependencies.getJob).toHaveBeenCalledOnce();
    dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.dependencies.getJob).toHaveBeenCalledOnce();
    expect(harness.unlisten).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
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
