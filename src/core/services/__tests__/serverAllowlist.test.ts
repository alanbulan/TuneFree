import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyProxyAllowlist, PROXY_REQUIRED_HOSTS } from '../serverAllowlist';
const mocks = vi.hoisted(() => ({ tauri: true }));
vi.mock('../../ipc/env', () => ({ isTauri: () => mocks.tauri }));
beforeEach(() => { mocks.tauri = true; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('后端代理白名单诊断', () => {
  it('完整列表和父域覆盖通过，缺少域名只告警', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ hosts: PROXY_REQUIRED_HOSTS })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ hosts: ['kuwo.cn'] })));
    vi.stubGlobal('fetch', fetch); await verifyProxyAllowlist(); expect(console.warn).not.toHaveBeenCalled();
    await verifyProxyAllowlist(); expect(console.warn).toHaveBeenCalled();
    expect(vi.mocked(console.warn).mock.calls.some((call) => String(call[0]).includes('search.kuwo.cn'))).toBe(false);
  });
  it('HTTP、结构和网络失败不会阻断启动，浏览器跳过检查', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('failure', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"hosts":[12]}')).mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetch); for (let i = 0; i < 3; i++) await expect(verifyProxyAllowlist()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(3); mocks.tauri = false; await verifyProxyAllowlist(); expect(fetch).toHaveBeenCalledTimes(3);
  });
});
