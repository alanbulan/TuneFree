import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../core/__tests__/deferred';
import { useCompanionThinking } from '../useCompanionThinking';
const mocks = vi.hoisted(() => ({ tauri: true, listen: vi.fn(), latest: vi.fn(), dispose: vi.fn(), events: new Map<string, (p?: unknown) => void>() }));
vi.mock('../../../core/ipc', () => ({ isTauri: () => mocks.tauri, listenEvent: mocks.listen }));
vi.mock('../../../core/services/recommendation', () => ({ getLatestRecommendationJob: mocks.latest }));
const ready = async () => { await act(async () => {}); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.tauri = true; mocks.events.clear(); mocks.latest.mockReset().mockResolvedValue(null);
  mocks.listen.mockReset().mockImplementation(async (name, handler) => { mocks.events.set(name, handler); return mocks.dispose; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('音乐伙伴 AI 工作状态', () => {
  it('任务事件优先于晚到的初始化，ready 重读并与意境请求合并', async () => {
    const pending = deferred<unknown>(); mocks.latest.mockReturnValueOnce(pending.promise);
    const view = renderHook(({ busy }) => useCompanionThinking(busy), { initialProps: { busy: false } }); await ready();
    act(() => mocks.events.get('recommendation-job-update')?.({ status: 'pending' })); expect(view.result.current).toBe(true);
    await act(async () => pending.resolve({ status: 'completed' })); expect(view.result.current).toBe(true);
    act(() => mocks.events.get('recommendation-job-update')?.({ status: 'completed' })); expect(view.result.current).toBe(false);
    mocks.latest.mockResolvedValueOnce({ status: 'running' }); act(() => mocks.events.get('recommendation-ready')?.()); await ready(); expect(view.result.current).toBe(true);
    mocks.latest.mockRejectedValueOnce(new Error('还未初始化')); act(() => mocks.events.get('recommendation-ready')?.()); await ready(); expect(view.result.current).toBe(true);
    act(() => mocks.events.get('recommendation-job-update')?.({ status: 'failed' })); view.rerender({ busy: true }); expect(view.result.current).toBe(true);
    view.unmount(); expect(mocks.dispose).toHaveBeenCalledTimes(2);
    const calls = mocks.latest.mock.calls.length; act(() => { mocks.events.get('recommendation-ready')?.(); mocks.events.get('recommendation-job-update')?.({ status: 'running' }); });
    expect(mocks.latest).toHaveBeenCalledTimes(calls);
  });
  it('部分订阅失败保留可用订阅，晚到注册被释放，浏览器不订阅', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); mocks.listen.mockRejectedValueOnce(new Error('订阅失败'));
    const view = renderHook(() => useCompanionThinking(false)); await ready(); expect(console.warn).toHaveBeenCalledTimes(1); view.unmount();
    const pending = deferred<() => void>(); mocks.listen.mockReturnValue(pending.promise);
    const next = renderHook(() => useCompanionThinking(false)); next.unmount(); await act(async () => pending.resolve(mocks.dispose)); expect(mocks.dispose).toHaveBeenCalledTimes(3);
    mocks.tauri = false; mocks.listen.mockClear(); const browser = renderHook(() => useCompanionThinking(true)); expect(browser.result.current).toBe(true); expect(mocks.listen).not.toHaveBeenCalled();
  });
});
