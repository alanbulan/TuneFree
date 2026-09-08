import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocalServerInfo } from '../config';
import { getProxies, isLocalServerProxy, proxyFetch, proxyFetchJson, proxyFetchJsonWithValidator } from '../proxy';

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

describe('代理备用路径和响应验证', () => {
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('自定义代理只作后备且不携带本地令牌，禁用过时代理', async () => {
    expect(isLocalServerProxy('bad')).toBe(false); localStorage.setItem('tunefree_cors_proxy', 'https://corsproxy.io/?'); expect(getProxies()).toHaveLength(1);
    localStorage.setItem('tunefree_cors_proxy', 'https://backup.test/?url='); expect(getProxies()).toHaveLength(2);
    const fetch = vi.fn().mockRejectedValueOnce(new Error('first')).mockResolvedValueOnce(new Response('{"valid":true}')); vi.stubGlobal('fetch', fetch);
    await expect(proxyFetchJsonWithValidator('https://music.test', { method: 'POST' }, (data) => data.valid === true)).resolves.toEqual({ valid: true });
    const options = fetch.mock.calls[1][1]; expect(options.mode).toBe('cors'); expect(new Headers(options.headers).has('x-tunefree-token')).toBe(false);
  });
  it('保留最后一个失败响应的状态和正文，全部网络失败返回空', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValueOnce(new Response('rate limit', { status: 429 })).mockResolvedValueOnce(new Response(null, { status: 503 })).mockRejectedValueOnce(new Error('offline')); vi.stubGlobal('fetch', fetch);
    const response = await proxyFetch('not a url'); expect(response?.status).toBe(429); expect(await response?.text()).toBe('rate limit');
    const empty = await proxyFetch('https://music.test'); expect(empty?.status).toBe(503); expect(await empty?.text()).toBe('');
    expect(await proxyFetch('https://music.test')).toBeNull(); expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not a url'));
  });
  it('JSONP、JSON 结构验证和取消透传，不把坏正文当有效数据', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    fetch.mockResolvedValueOnce(new Response('callback({"value":1});')); expect(await proxyFetchJson('https://music.test')).toEqual({ value: 1 });
    fetch.mockResolvedValueOnce(new Response('callback(bad)')); expect(await proxyFetchJson('https://music.test')).toBeNull();
    fetch.mockResolvedValueOnce(new Response('{"valid":false}', { status: 403 })); expect(await proxyFetchJsonWithValidator('https://music.test', {}, (data) => data.valid)).toBeNull();
    fetch.mockResolvedValueOnce(new Response('bad')); expect(await proxyFetchJsonWithValidator('https://music.test')).toBeNull();
    fetch.mockResolvedValueOnce(new Response('{"valid":true}')); expect(await proxyFetchJsonWithValidator('https://music.test')).toEqual({ valid: true });
    const controller = new AbortController(); controller.abort(new Error('取消')); fetch.mockRejectedValueOnce(controller.signal.reason);
    await expect(proxyFetchJsonWithValidator('https://music.test', { signal: controller.signal })).rejects.toThrow('取消');
  });
});
