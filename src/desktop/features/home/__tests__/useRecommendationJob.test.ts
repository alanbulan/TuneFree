import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../../core/__tests__/deferred';
import { recommendationJob as job, recommendationSong as song } from '../../../../core/__tests__/recommendationFixtures';
import { getLatestRecommendationJob, refreshRecommendations } from '../../../../core/services/recommendation';
import { startRecommendationRuntime } from '../../../../core/services/recommendationRuntime';
import { useRecommendationJob } from '../useRecommendationJob';

const mocks = vi.hoisted(() => ({ listen: vi.fn(), toast: vi.fn(), dismiss: vi.fn(),
  handlers: new Map<string, () => void>() }));
vi.mock('../../../../core/ipc', async (original) => ({ ...await original<typeof import('../../../../core/ipc')>(),
  isTauri: () => true, listenEvent: mocks.listen }));
vi.mock('../../../../core/services/recommendation', async (original) => ({ ...await original<typeof import('../../../../core/services/recommendation')>(),
  getLatestRecommendationJob: vi.fn(), refreshRecommendations: vi.fn(), dismissRecommendation: mocks.dismiss }));
const ready = async () => { await act(async () => {}); };
let stop: () => void;
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.handlers.clear();
  mocks.listen.mockImplementation(async (event, callback) => { mocks.handlers.set(event, callback); return () => {}; });
  vi.mocked(getLatestRecommendationJob).mockReset().mockResolvedValue(null);
  vi.mocked(refreshRecommendations).mockReset().mockResolvedValue(null);
  stop = startRecommendationRuntime(); await ready();
});
afterEach(() => { cleanup(); stop(); vi.useRealTimers(); });
const load = async (value: ReturnType<typeof job> | null) => {
  vi.mocked(getLatestRecommendationJob).mockResolvedValue(value);
  act(() => mocks.handlers.get('recommendation-job-update')?.()); await ready();
};

describe('推荐页共享任务快照', () => {
  it('未激活的标签也接收最新任务，切页不取消任务；本地直接完成会刷新列表', async () => {
    const { result, rerender, unmount } = renderHook(({ active }) => useRecommendationJob(active, mocks.toast), { initialProps: { active: false } });
    await load(job({ status: 'running', stage: 'cloud_rerank', items: [] }));
    expect(result.current.loading).toBe(false); expect(result.current.running).toBe(true);
    rerender({ active: true }); expect(result.current.loading).toBe(true);
    rerender({ active: false });
    await load(job({ jobId: 'new-local', stage: 'local_only', cloudEnabled: false }));
    expect(result.current.songs[0]).toMatchObject({ ...song, recommendationRequestId: 'request' });
    expect(result.current.running).toBe(false);
    unmount(); expect(mocks.handlers.size).toBe(2);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('清空、等待、停用与失败分别显示，不恢复已清空的旧结果', async () => {
    const { result, rerender } = renderHook(({ active }) => useRecommendationJob(active, mocks.toast), { initialProps: { active: true } });
    await load(job()); expect(result.current.songs).toHaveLength(1);
    await load(job({ status: 'waiting', stage: 'waiting' })); expect(result.current.waiting).toBe(true);
    await load(job({ status: 'error', error: '模型服务暂不可用' }));
    expect(result.current.error).toBe('模型服务暂不可用'); expect(result.current.songs).toHaveLength(1);
    rerender({ active: false }); expect(result.current.error).toBe('');
    await load(job({ status: 'disabled', stage: 'disabled', items: [] })); expect(result.current.disabled).toBe(true);
    await load(null); expect(result.current.songs).toEqual([]); expect(result.current.disabled).toBe(false);
  });

  it('反馈成功后的列表移除只改变快照，不再次提交不感兴趣', async () => {
    const { result } = renderHook(() => useRecommendationJob(true, mocks.toast));
    act(() => result.current.removeSong(song));
    await load(job()); act(() => result.current.removeSong(song));
    expect(result.current.songs).toEqual([]); expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it('主动刷新复用请求，完成后重读；失败显示操作错误', async () => {
    const { result } = renderHook(() => useRecommendationJob(true, mocks.toast));
    const pending = deferred<ReturnType<typeof job> | null>();
    vi.mocked(refreshRecommendations).mockReturnValueOnce(pending.promise);
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = result.current.refresh(); second = result.current.refresh(); });
    expect(refreshRecommendations).toHaveBeenCalledOnce();
    vi.mocked(getLatestRecommendationJob).mockResolvedValue(job());
    await act(async () => { pending.resolve(job()); await Promise.all([first, second]); });
    expect(result.current.songs).toHaveLength(1);
    vi.mocked(refreshRecommendations).mockRejectedValueOnce(new Error('network'));
    await act(() => result.current.refresh());
    expect(mocks.toast).toHaveBeenCalledWith('暂时无法刷新推荐，请稍后重试', 'warning');
  });
});
