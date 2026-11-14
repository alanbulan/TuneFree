import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deferred } from '../../__tests__/deferred';
import { resolveAccountUrl } from '../accountResolution';
const native = vi.hoisted(() => ({ enabled: true, invoke: vi.fn() }));
vi.mock('../../ipc', async (original) => ({ ...await original<typeof import('../../ipc')>(),
  isTauri: () => native.enabled, invokeCommand: native.invoke }));
const request = { platform: 'qq', id: 'MID', quality: 'flac', strMediaMid: 'MEDIA' };
beforeEach(() => { native.enabled = true; native.invoke.mockReset().mockResolvedValue({ url: 'https://cdn.test/a.mp3', quality: '320k', state: 'connected', message: null }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('uses typed native IPC and passes quality, media MID and rejected URLs', async () => {
  await expect(resolveAccountUrl({ ...request, rejectedUrls: ['https://dead.test/a.mp3'] })).resolves.toMatchObject({ state: 'connected' });
  expect(native.invoke).toHaveBeenCalledWith('resolve_platform_account_url', {
    platform: 'qq', songId: 'MID', quality: 'flac', mediaMid: 'MEDIA', rejectedUrls: ['https://dead.test/a.mp3'],
  });
  await resolveAccountUrl({ platform: 'netease', id: 123, quality: '128k' });
  expect(native.invoke.mock.lastCall?.[1]).toEqual({ platform: 'netease', songId: '123', quality: '128k' });
});
it('skips browsers and unsupported platforms, and preserves native errors for fallback', async () => {
  native.enabled = false; expect(await resolveAccountUrl(request)).toBeNull();
  native.enabled = true; expect(await resolveAccountUrl({ ...request, platform: 'kugou' })).toBeNull();
  expect(native.invoke).not.toHaveBeenCalled();
  native.invoke.mockRejectedValueOnce(new Error('network unavailable'));
  expect(await resolveAccountUrl(request)).toMatchObject({ state: 'unavailable', message: 'network unavailable' });
});
it('cancels promptly even if native IPC is still pending and discards the late result', async () => {
  const controller = new AbortController(); const pending = deferred<unknown>(); native.invoke.mockReturnValueOnce(pending.promise);
  const result = resolveAccountUrl({ ...request, signal: controller.signal });
  controller.abort(); await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  pending.resolve({ url: 'https://old.test/song.mp3' });
  await expect(resolveAccountUrl({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
it('bounds an unanswered credential/IPC request and ignores its late account URL', async () => {
  vi.useFakeTimers(); const pending = deferred<unknown>(); native.invoke.mockReturnValueOnce(pending.promise);
  const result = resolveAccountUrl(request);
  await vi.advanceTimersByTimeAsync(14_000);
  await expect(result).resolves.toMatchObject({ url: null, state: 'unavailable', message: expect.stringContaining('系统凭据权限') });
  pending.resolve({ url: 'https://old.test/song.mp3' });
  expect(vi.getTimerCount()).toBe(0);
});
