import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcError } from '../../../../core/ipc';
import { deferred } from '../../../../core/__tests__/deferred';
import { dismissRecommendation, getLatestRecommendationJob, type RecommendationJob } from '../../../../core/services/recommendation';
import { getRecommendationTaskProgress } from '../../../../core/services/recommendationTaskProgress';
import { useRecommendationJob } from '../useRecommendationJob';
import { watchRecommendationJob } from '../recommendationJobWatcher';

const mocks = vi.hoisted(() => ({ tauri: true, listen: vi.fn(), dispose: vi.fn(), toast: vi.fn(),
  handlers: new Map<string, (payload?: unknown) => void>() }));
vi.mock('../../../../core/ipc', async (original) => ({ ...await original<typeof import('../../../../core/ipc')>(), isTauri: () => mocks.tauri, listenEvent: mocks.listen }));
vi.mock('../../../../core/services/recommendation', async (original) => ({ ...await original<typeof import('../../../../core/services/recommendation')>(), getLatestRecommendationJob: vi.fn(), dismissRecommendation: vi.fn() }));
vi.mock('../recommendationJobWatcher', async (original) => ({ ...await original<typeof import('../recommendationJobWatcher')>(), watchRecommendationJob: vi.fn() }));
const song = { id: 'song', name: '推荐', artist: '歌手', album: '', source: 'qq' };
const item = { song, score: 0.9, reasons: ['喜欢的风格'], recommendationSource: 'hybrid', requestId: 'request' };
const job = (patch: Partial<RecommendationJob> = {}): RecommendationJob => ({ jobId: 'job', status: 'done', stage: 'done', detail: '完成', items: [item], updatedAt: 1, ...patch });
const ready = async () => { await act(async () => {}); };
const mount = (active = true) => renderHook(({ active }) => useRecommendationJob(active, mocks.toast), { initialProps: { active } });
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.tauri = true; mocks.handlers.clear();
  mocks.listen.mockReset().mockImplementation((event, callback) => { mocks.handlers.set(event, callback); return Promise.resolve(mocks.dispose); });
  vi.mocked(getLatestRecommendationJob).mockReset().mockResolvedValue(job());
  vi.mocked(dismissRecommendation).mockReset().mockResolvedValue(undefined);
  vi.mocked(watchRecommendationJob).mockReset().mockReturnValue(mocks.dispose);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('推荐页任务生命周期', () => {
  it('激活时订阅并读取，完成任务显示元数据，新任务事件和就绪事件重新加载', async () => {
    const { result, rerender, unmount } = mount(false); expect(getLatestRecommendationJob).not.toHaveBeenCalled();
    rerender({ active: true }); await ready();
    expect(result.current.songs[0]).toMatchObject({ ...song, recommendationRequestId: 'request', recommendationReasons: ['喜欢的风格'] });
    expect(result.current.loading).toBe(false);
    act(() => mocks.handlers.get('recommendation-job-update')?.({ jobId: 'job', status: 'running' })); await ready();
    expect(getLatestRecommendationJob).toHaveBeenCalledTimes(1);
    act(() => mocks.handlers.get('recommendation-job-update')?.({ jobId: 'new', status: 'running' })); await ready();
    expect(getLatestRecommendationJob).toHaveBeenCalledTimes(2);
    act(() => mocks.handlers.get('recommendation-ready')?.()); await ready(); expect(getLatestRecommendationJob).toHaveBeenCalledTimes(3);
    act(() => result.current.removeSong(result.current.songs[0])); await ready();
    expect(result.current.songs).toEqual([]); expect(dismissRecommendation).toHaveBeenCalledWith(expect.objectContaining(song), 'home_dismiss');
    unmount(); expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });

  it('没有任务和空任务给出可操作提示，本地结果与错误结果保留当前歌单', async () => {
    mocks.tauri = false; vi.mocked(getLatestRecommendationJob).mockResolvedValueOnce(null);
    const { result, rerender } = mount(); await ready();
    expect(result.current.error).toContain('推荐任务正在准备');
    expect(getRecommendationTaskProgress().cloud.detail).toBe('还没有推荐记录');
    const load = async (value: RecommendationJob) => {
      rerender({ active: false }); vi.mocked(getLatestRecommendationJob).mockResolvedValueOnce(value); rerender({ active: true }); await ready();
    };
    await load(job({ items: [], stage: 'local_only' })); expect(mocks.toast).toHaveBeenCalledWith('多播放或收藏几首歌后，推荐会更准确', 'info');
    expect(getRecommendationTaskProgress().cloud.status).toBe('disabled');
    await load(job({ status: 'error', error: 'offline', items: [{ ...item, recommendationSource: 'local' }] }));
    expect(result.current.songs).toHaveLength(1); expect(mocks.toast).toHaveBeenLastCalledWith('云端发现与重排暂不可用，已保留当前推荐', 'warning');
  });

  it('运行中的云端任务由 watcher 接续，未生成精选前不混入候选，清理旧 watcher', async () => {
    vi.mocked(getLatestRecommendationJob).mockResolvedValueOnce(job({ status: 'running', stage: 'cloud_rerank', items: [{ ...item, recommendationSource: 'local' }] }));
    const { result, rerender } = mount(); await ready(); expect(result.current.loading).toBe(true); expect(result.current.songs).toEqual([]);
    const callbacks = vi.mocked(watchRecommendationJob).mock.calls[0][1]; expect(callbacks.isCurrent()).toBe(true);
    act(() => { callbacks.setSongs([song]); callbacks.setLoading(false); callbacks.showWarning(); });
    expect(result.current.songs).toEqual([song]); expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('保留当前推荐'), 'warning');
    act(() => mocks.handlers.get('recommendation-ready')?.()); await ready(); expect(mocks.dispose).toHaveBeenCalled();
    expect(callbacks.isCurrent()).toBe(false);
    rerender({ active: false });
  });

  it('BUSY 退避展示初始化状态，耗尽后停止，普通失败直接反馈', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getLatestRecommendationJob).mockRejectedValue(new IpcError('BUSY', '启动中'));
    const { result, rerender } = mount(); await ready(); expect(result.current.initializing).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(4000)); expect(result.current.initializing).toBe(false);
    expect(result.current.error).toBe('推荐服务正在初始化，请稍后重试。');
    rerender({ active: false }); vi.mocked(getLatestRecommendationJob).mockRejectedValueOnce(new Error('network'));
    rerender({ active: true }); await ready(); expect(result.current.error).toBe('推荐暂不可用。');
  });

  it('切页后迟到请求不更新，订阅失败仍可读取，迟到订阅立即释放', async () => {
    const pending = deferred<RecommendationJob | null>(); vi.mocked(getLatestRecommendationJob).mockReturnValueOnce(pending.promise);
    const { result, rerender, unmount } = mount(); await ready(); rerender({ active: false });
    await act(async () => pending.resolve(job())); expect(result.current.songs).toEqual([]); unmount();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.listen.mockRejectedValueOnce(new Error('events'));
    const recovered = mount(); await ready(); expect(recovered.result.current.songs).toHaveLength(1); expect(warning).toHaveBeenCalled();
    vi.mocked(dismissRecommendation).mockRejectedValueOnce(new Error('feedback'));
    act(() => recovered.result.current.removeSong(song)); await ready(); expect(warning).toHaveBeenLastCalledWith('提交「不感兴趣」反馈失败', expect.any(Error));
    recovered.unmount();
    const subscription = deferred<() => void>(); mocks.listen.mockReturnValueOnce(subscription.promise);
    const late = mount(); late.unmount(); const dispose = vi.fn(); await act(async () => subscription.resolve(dispose)); expect(dispose).toHaveBeenCalledOnce();
  });
});
