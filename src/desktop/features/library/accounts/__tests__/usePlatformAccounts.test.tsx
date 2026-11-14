import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../../../core/__tests__/deferred';
import type { PlatformAccount, PlatformLoginAttempt } from '../../../../../core/ipc';
import { useAccountPlaylists, usePlatformAccounts } from '../usePlatformAccounts';

const mocks = vi.hoisted(() => ({ native: true, list: vi.fn(), start: vi.fn(), finish: vi.fn(), cancel: vi.fn(), refresh: vi.fn(), logout: vi.fn(), playlists: vi.fn() }));
vi.mock('../../../../../core/ipc', async (original) => ({ ...await original<typeof import('../../../../../core/ipc')>(), isTauri: () => mocks.native }));
vi.mock('../../../../../core/services/platformAccounts', () => ({ accountPlatformName: (value: string) => value,
  platformAccounts: { list: mocks.list, start: mocks.start, finish: mocks.finish, cancel: mocks.cancel, refresh: mocks.refresh, logout: mocks.logout, playlists: mocks.playlists } }));
const account: PlatformAccount = { platform: 'netease', userId: '123', nickname: 'fixture', avatarUrl: null, state: 'connected', connectedAt: 1 };
const attempt: PlatformLoginAttempt = { platform: 'netease', attemptId: 'attempt', startedAt: 1 };
const settle = async () => { await act(async () => {}); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.native = true;
  mocks.list.mockReset().mockResolvedValue([]); mocks.start.mockReset().mockResolvedValue(attempt);
  mocks.finish.mockReset().mockResolvedValue({ state: 'waiting', account: null });
  mocks.cancel.mockReset().mockResolvedValue(undefined); mocks.refresh.mockReset().mockResolvedValue(account);
  mocks.logout.mockReset().mockResolvedValue(undefined); mocks.playlists.mockReset().mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('native account lifecycle', () => {
  it('connects, checks, refreshes and logs out without storing credentials in browser data', async () => {
    const { result } = renderHook(usePlatformAccounts); await settle();
    await act(async () => result.current.start('netease'));
    await act(async () => result.current.checkLogin(true)); expect(result.current.loginError).toContain('尚未检测');
    mocks.finish.mockResolvedValueOnce({ state: 'connected', account });
    await act(async () => result.current.checkLogin(true));
    expect(result.current.accounts).toEqual([account]); expect(result.current.attempt).toBeNull();
    await act(async () => result.current.refresh('netease')); expect(mocks.refresh).toHaveBeenCalledWith('netease');
    await act(async () => result.current.logout('netease')); expect(result.current.accounts).toEqual([]);
  });

  it('cancels an active or late-starting login when unmounted', async () => {
    const first = renderHook(usePlatformAccounts); await settle();
    await act(async () => first.result.current.start('netease')); first.unmount(); await settle();
    expect(mocks.cancel).toHaveBeenCalledWith('netease', 'attempt');
    mocks.cancel.mockClear(); const pending = deferred<PlatformLoginAttempt>(); mocks.start.mockReturnValueOnce(pending.promise);
    const second = renderHook(usePlatformAccounts); await settle();
    let work: Promise<void>; act(() => { work = second.result.current.start('netease'); }); second.unmount();
    await act(async () => { pending.resolve(attempt); await work; });
    expect(mocks.cancel).toHaveBeenCalledWith('netease', 'attempt');
  });

  it('ignores late login success after cancellation', async () => {
    const { result } = renderHook(usePlatformAccounts); await settle(); await act(async () => result.current.start('netease'));
    const pending = deferred<{ state: string; account: PlatformAccount }>(); mocks.finish.mockReturnValueOnce(pending.promise);
    let work: Promise<void>; act(() => { work = result.current.checkLogin(true); });
    await act(async () => result.current.cancel());
    await act(async () => { pending.resolve({ state: 'connected', account }); await work; });
    expect(result.current.accounts).toEqual([]); expect(result.current.attempt).toBeNull();
  });

  it('handles closed and timed-out attempts, native errors, expired sessions and logout failures', async () => {
    mocks.list.mockResolvedValue([account]); const { result } = renderHook(usePlatformAccounts); await settle();
    for (const state of ['closed', 'expired']) {
      await act(async () => result.current.start('netease')); mocks.finish.mockResolvedValueOnce({ state, account: null });
      await act(async () => result.current.checkLogin()); expect(result.current.attempt).toBeNull(); expect(result.current.error).toBeTruthy();
    }
    mocks.start.mockRejectedValueOnce({ code: 'CREDENTIAL_UNAVAILABLE', message: '系统凭据拒绝' });
    await act(async () => result.current.start('netease')); expect(result.current.error).toBe('系统凭据拒绝');
    await act(async () => result.current.start('netease')); mocks.finish.mockRejectedValueOnce({ code: 'AUTH_REQUIRED', message: '未登录' });
    await act(async () => result.current.checkLogin()); expect(result.current.loginError).toContain('平台尚未');
    mocks.cancel.mockRejectedValueOnce(new Error('cancel failed')); await act(async () => result.current.cancel());
    expect(result.current.loginError).toBe('cancel failed'); expect(result.current.attempt).toEqual(attempt);
    await act(async () => result.current.cancel()); expect(result.current.attempt).toBeNull();
    mocks.refresh.mockRejectedValueOnce({ code: 'AUTH_REQUIRED', message: '已失效' });
    await act(async () => result.current.refresh('netease')); expect(result.current.accounts[0].state).toBe('expired');
    mocks.logout.mockRejectedValueOnce(new Error('delete failed')); await act(async () => result.current.logout('netease'));
    expect(result.current.accounts).toHaveLength(1); expect(result.current.error).toBe('delete failed');
    mocks.list.mockRejectedValueOnce(new Error('vault failed')); await act(async () => result.current.load()); expect(result.current.error).toBe('vault failed');
  });

  it('polls only when visible and stops polling after errors or unmount', async () => {
    vi.useFakeTimers(); const { result, unmount } = renderHook(usePlatformAccounts); await settle();
    await act(async () => result.current.start('netease'));
    await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(mocks.finish).toHaveBeenCalledTimes(1);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(mocks.finish).toHaveBeenCalledTimes(1); visibility.mockRestore();
    mocks.finish.mockRejectedValueOnce(new Error('network'));
    await act(async () => vi.advanceTimersByTimeAsync(3000)); await act(async () => vi.advanceTimersByTimeAsync(9000));
    expect(mocks.finish).toHaveBeenCalledTimes(2); unmount();
  });

  it('blocks another login during cancellation and reconciles an already committed native login', async () => {
    const { result } = renderHook(usePlatformAccounts); await settle();
    await act(async () => result.current.start('netease'));
    const pending = deferred<void>(); mocks.cancel.mockReturnValueOnce(pending.promise);
    let work: Promise<void>; act(() => { work = result.current.cancel(); });
    await act(async () => result.current.start('qq'));
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(result.current.attempt).toEqual(attempt);
    mocks.list.mockResolvedValueOnce([account]);
    await act(async () => { pending.reject({ code: 'CANCELLED', message: 'login finished' }); await work; });
    expect(result.current.attempt).toBeNull(); expect(result.current.accounts).toEqual([account]);
    expect(result.current.busyPlatform).toBeNull();
  });

  it('browser mode never requests credentials and load results after unmount are ignored', async () => {
    mocks.native = false; const first = renderHook(usePlatformAccounts); await settle();
    expect(first.result.current.loading).toBe(false); expect(mocks.list).not.toHaveBeenCalled(); first.unmount();
    mocks.native = true; const pending = deferred<PlatformAccount[]>(); mocks.list.mockReturnValueOnce(pending.promise);
    const second = renderHook(usePlatformAccounts); await settle(); second.unmount();
    await act(async () => pending.resolve([account]));
  });
});

describe('platform playlist lifecycle', () => {
  it('does not show a previous platform response after switching accounts', async () => {
    const pending = deferred<[]>(); mocks.playlists.mockReturnValueOnce(pending.promise);
    const expired = vi.fn(); const { result, rerender } = renderHook(({ user }) => useAccountPlaylists(user, expired), { initialProps: { user: account as PlatformAccount | null } });
    await settle(); rerender({ user: { ...account, platform: 'qq' } }); await settle();
    await act(async () => pending.resolve([])); expect(mocks.playlists).toHaveBeenLastCalledWith('qq');
    mocks.playlists.mockRejectedValueOnce({ code: 'AUTH_REQUIRED', message: 'expired' });
    await act(async () => result.current.reload()); expect(expired).toHaveBeenCalledWith('qq');
    expect(result.current.error).toBe('expired'); rerender({ user: null }); await settle(); expect(result.current.playlists).toEqual([]);
    rerender({ user: { ...account, state: 'expired' } }); await settle(); expect(result.current.loading).toBe(false);
  });
});
