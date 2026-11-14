import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deferred } from '../../../core/__tests__/deferred';
import { getPlaybackGeneration } from '../../../core/services/sources/generation';
import { MusicSourceRuntime } from '../MusicSourceRuntime';
const mocks = vi.hoisted(() => ({ native: true, initialize: vi.fn(), listen: vi.fn(), unlisten: vi.fn() }));
vi.mock('../../../core/ipc', () => ({ isTauri: () => mocks.native, listenEvent: mocks.listen }));
vi.mock('../../../core/services/sources/manager', () => ({ ensureMusicSourcesInitialized: mocks.initialize }));
beforeEach(() => { vi.clearAllMocks(); mocks.native = true; mocks.initialize.mockResolvedValue(undefined); mocks.listen.mockResolvedValue(mocks.unlisten); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('keeps account cache invalidation active outside the account page and removes its listener', async () => {
  const before = getPlaybackGeneration(); const view = render(<MusicSourceRuntime />); await act(async () => {});
  expect(mocks.listen.mock.calls[0][0]).toBe('platform-account-changed'); mocks.listen.mock.calls[0][1]();
  expect(getPlaybackGeneration()).toBe(before + 1); view.unmount(); expect(mocks.unlisten).toHaveBeenCalledOnce();
});
it('cleans up a late native subscription, ignores unavailable events and skips browsers', async () => {
  const pending = deferred<() => void>(); mocks.listen.mockReturnValueOnce(pending.promise);
  const view = render(<MusicSourceRuntime />); view.unmount(); await act(async () => pending.resolve(mocks.unlisten));
  expect(mocks.unlisten).toHaveBeenCalledOnce();
  mocks.listen.mockRejectedValueOnce(new Error('unavailable')); mocks.initialize.mockRejectedValueOnce(new Error('source failed'));
  vi.spyOn(console, 'warn').mockImplementation(() => {}); const second = render(<MusicSourceRuntime />); await act(async () => {}); second.unmount();
  mocks.native = false; mocks.listen.mockClear(); mocks.initialize.mockClear(); render(<MusicSourceRuntime />);
  expect(mocks.listen).not.toHaveBeenCalled(); expect(mocks.initialize).not.toHaveBeenCalled();
});
