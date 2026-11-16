import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../__tests__/deferred';
import { recommendationJob as job } from '../../__tests__/recommendationFixtures';
import { IpcError } from '../../ipc';
import { RECOMMENDATION_CHANGED_EVENT, type RecommendationJob } from '../recommendation';
import { getRecommendationTaskProgress } from '../recommendationTaskProgress';
import {
  getRecommendationRuntimeState, startRecommendationRuntime, subscribeRecommendationRuntime,
} from '../recommendationRuntime';

const mocks = vi.hoisted(() => ({ native: true, latest: vi.fn(), listen: vi.fn(),
  handlers: new Map<string, () => void>(), unlisten: vi.fn() }));
vi.mock('../../ipc', async (original) => ({ ...await original<typeof import('../../ipc')>(),
  isTauri: () => mocks.native, listenEvent: mocks.listen }));
vi.mock('../recommendation', async (original) => ({ ...await original<typeof import('../recommendation')>(), getLatestRecommendationJob: mocks.latest }));
let stops: Array<() => void>;
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const start = () => { const stop = startRecommendationRuntime(); stops.push(stop); return stop; };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); stops = []; mocks.native = true; mocks.handlers.clear();
  mocks.latest.mockReset().mockResolvedValue(null);
  mocks.listen.mockReset().mockImplementation(async (event, callback) => { mocks.handlers.set(event, callback); return mocks.unlisten; });
});
afterEach(() => { stops.forEach((stop) => stop()); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('应用全局推荐任务运行时', () => {
  it('原生根级仅一个监听，浏览器不请求；后台完成更新卡片并保留真实完成时间', async () => {
    mocks.native = false; start(); expect(mocks.latest).not.toHaveBeenCalled();
    mocks.native = true; mocks.latest.mockResolvedValue(job({ status: 'running' }));
    const changed = vi.fn(); const unsubscribe = subscribeRecommendationRuntime(changed);
    const stop = start(); start(); await flush();
    expect(mocks.listen).toHaveBeenCalledTimes(2);
    expect(getRecommendationTaskProgress().cloud.status).toBe('running');
    mocks.latest.mockResolvedValue(job({ jobId: 'new', updatedAt: 9000, resultUpdatedAt: 4000 }));
    mocks.handlers.get('recommendation-job-update')?.(); await flush();
    expect(getRecommendationRuntimeState().job?.jobId).toBe('new');
    expect(getRecommendationTaskProgress().cloud).toMatchObject({ status: 'done', updatedAt: 4000 });
    expect(getRecommendationTaskProgress().local.updatedAt).toBe(1000);
    expect(changed).toHaveBeenCalled(); unsubscribe(); stop();
    const count = mocks.latest.mock.calls.length;
    mocks.handlers.get('recommendation-ready')?.(); await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.latest).toHaveBeenCalledTimes(count); expect(mocks.unlisten).toHaveBeenCalledTimes(2);
  });

  it('本地直接完成、等待、取消、停用和空任务都更新，不把取消标成刷新完成', async () => {
    start(); await flush();
    expect(getRecommendationRuntimeState().job).toBeNull();
    for (const status of ['waiting', 'cancelled', 'disabled', 'error'] as const) {
      mocks.latest.mockResolvedValue(job({ status, localUpdatedAt: 0, resultUpdatedAt: 0 }));
      mocks.handlers.get('recommendation-job-update')?.(); await flush();
      expect(getRecommendationTaskProgress().cloud.status).toBe(status);
    }
    mocks.latest.mockResolvedValue(job({ jobId: 'local', stage: 'local_only', cloudEnabled: false }));
    mocks.handlers.get('recommendation-job-update')?.(); await flush();
    expect(getRecommendationRuntimeState().job?.jobId).toBe('local');
    expect(getRecommendationTaskProgress().cloud.status).toBe('disabled');
    mocks.latest.mockResolvedValue(null); mocks.handlers.get('recommendation-ready')?.(); await flush();
    expect(getRecommendationTaskProgress().cloud.updatedAt).toBe(0);
  });

  it('事件使旧读取失效，串行补读；清空立即删除旧列表，迟到结果不能复活', async () => {
    const pending = deferred<RecommendationJob | null>();
    mocks.latest.mockReturnValueOnce(pending.promise); start(); await flush();
    mocks.latest.mockResolvedValue(job()); mocks.handlers.get('recommendation-job-update')?.();
    pending.resolve(job({ jobId: 'stale' })); await flush();
    expect(getRecommendationRuntimeState().job?.jobId).toBe('job');
    const late = deferred<RecommendationJob | null>(); mocks.latest.mockReturnValueOnce(late.promise);
    mocks.handlers.get('recommendation-ready')?.();
    mocks.latest.mockResolvedValue(null);
    window.dispatchEvent(new CustomEvent(RECOMMENDATION_CHANGED_EVENT, { detail: 'cleared' }));
    expect(getRecommendationRuntimeState().job).toBeNull();
    late.resolve(job()); await flush(); expect(getRecommendationRuntimeState().job).toBeNull();
    window.dispatchEvent(new Event(RECOMMENDATION_CHANGED_EVENT)); await flush();
    expect(getRecommendationRuntimeState().job).toBeNull();
  });

  it('旧实例重复清理不会停止新实例的监听或刷新', async () => {
    const previous = start(); await flush(); previous();
    const current = start(); await flush(); previous();
    const before = mocks.latest.mock.calls.length;
    window.dispatchEvent(new Event(RECOMMENDATION_CHANGED_EVENT)); await flush();
    expect(mocks.latest).toHaveBeenCalledTimes(before + 1);
    current();
  });

  it('BUSY 有界退避但持续观察就绪，普通失败不假装任务成功，后续恢复清除错误', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.latest.mockRejectedValue(new IpcError('BUSY', '初始化')); start(); await flush();
    expect(getRecommendationRuntimeState().initializing).toBe(true);
    await vi.advanceTimersByTimeAsync(3500); expect(mocks.latest).toHaveBeenCalledTimes(9);
    await vi.advanceTimersByTimeAsync(9999); expect(mocks.latest).toHaveBeenCalledTimes(9);
    await vi.advanceTimersByTimeAsync(1); expect(mocks.latest).toHaveBeenCalledTimes(10);
    mocks.latest.mockRejectedValueOnce(new Error('offline')); mocks.handlers.get('recommendation-ready')?.(); await flush();
    expect(getRecommendationRuntimeState().error).toBe('推荐状态暂时无法读取');
    expect(getRecommendationTaskProgress().cloud.status).toBe('error'); expect(warning).toHaveBeenCalled();
    mocks.latest.mockResolvedValue(job()); mocks.handlers.get('recommendation-ready')?.(); await flush();
    expect(getRecommendationRuntimeState().error).toBe('');
  });

  it('订阅失败使用轮询，挂起订阅不阻止首次读取；清理后迟到订阅与读取释放', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registration = deferred<() => void>();
    mocks.listen.mockRejectedValueOnce(new Error('listener')).mockReturnValueOnce(registration.promise);
    mocks.latest.mockResolvedValue(job({ status: 'waiting' }));
    const stop = start(); await flush(); expect(mocks.latest).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000); expect(mocks.latest).toHaveBeenCalledTimes(2);
    const pending = deferred<RecommendationJob | null>(); mocks.latest.mockReturnValueOnce(pending.promise);
    mocks.handlers.get('recommendation-ready')?.();
    window.dispatchEvent(new Event(RECOMMENDATION_CHANGED_EVENT));
    stop(); registration.resolve(mocks.unlisten); pending.resolve(job({ jobId: 'late' })); await flush();
    expect(getRecommendationRuntimeState().job?.jobId).not.toBe('late'); expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
});
