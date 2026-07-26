import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocalServerInfo } from '../config';
import { getProxies, isLocalServerProxy, proxyFetch, proxyFetchJson } from '../proxy';

describe('proxy configuration', () => {
  afterEach(() => {
    setLocalServerInfo({ port: 3002, token: '' });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('recognizes stored loopback proxy URLs from an older dynamic port', () => {
    expect(isLocalServerProxy('http://127.0.0.1:3002/api/cors-proxy?url=')).toBe(true);
    expect(isLocalServerProxy('https://example.com/api/cors-proxy?url=')).toBe(false);
  });

  it('replaces a stale stored local proxy with the current dynamic endpoint', () => {
    setLocalServerInfo({ port: 43123, token: 'tok' });
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
      getItem: () => 'http://127.0.0.1:3002/api/cors-proxy?url=',
    });

    expect(getProxies()).toEqual([
      'http://127.0.0.1:43123/api/cors-proxy?token=tok&url=',
    ]);
  });

  it('stops proxy retries when the caller cancels the request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = proxyFetch('https://example.com/data', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('attaches the local server token header on self-proxy requests', async () => {
    setLocalServerInfo({ port: 43123, token: 'secret-token' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"ok":true}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(proxyFetchJson('https://music.163.com/api/test')).resolves.toEqual({
      ok: true,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('x-tunefree-token')).toBe('secret-token');
    expect(init.mode).toBeUndefined();
  });

  it('forwards the caller signal into proxyFetchJson requests', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url, init: RequestInit) => new Promise<never>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = proxyFetchJson('https://example.com/data', 8000, controller.signal);
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('logs a warning for 403/429 degraded responses instead of swallowing them', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(proxyFetchJson('https://music.163.com/api/test')).resolves.toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('music.163.com'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('403'),
    );
  });
});
