import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { relaySourceRequest } from '../relay';

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(() => true) }));

vi.mock('../../../ipc/env', () => ({ isTauri: mocks.isTauri }));

const envelope = {
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json' },
  bodyBase64: 'e30=',
};

const jsonResponse = (status: number, data: unknown): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

describe('relay', () => {
  beforeEach(() => {
    mocks.isTauri.mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('成功时把信封交回调用方', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, envelope));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      relaySourceRequest({ url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' }),
    ).resolves.toEqual({ envelope });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/source-proxy');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ url: 'https://a.test/x', method: 'GET' });
  });

  it('非 2xx 时返回后端错误文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { error: '音源代理不允许访问该地址：127.0.0.1' })));
    await expect(
      relaySourceRequest({ url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' }),
    ).resolves.toEqual({ error: '音源代理不允许访问该地址：127.0.0.1' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 502 })));
    await expect(
      relaySourceRequest({ url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' }),
    ).resolves.toEqual({ error: '源代理请求失败（HTTP 502）' });
  });

  it('信封格式不正确时返回错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { status: 'nope' })));
    await expect(
      relaySourceRequest({ url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' }),
    ).resolves.toEqual({ error: '源代理返回的信封格式不正确' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(
      relaySourceRequest({ url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' }),
    ).resolves.toEqual({ error: '源代理返回的信封格式不正确' });
  });

  it('网络异常返回错误；调用方取消则抛出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('网络不可达');
    }));
    await expect(
      relaySourceRequest({ url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' }),
    ).resolves.toEqual({ error: '网络不可达' });

    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('aborted');
    }));
    await expect(
      relaySourceRequest(
        { url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' },
        controller.signal,
      ),
    ).rejects.toThrow('aborted');
  });

  it('整体超时返回明确错误', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')));
    })));

    const pending = relaySourceRequest({ url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toEqual({ error: '源代理请求超时' });
  });

  it('浏览器 dev 环境直接说明原因', async () => {
    mocks.isTauri.mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      relaySourceRequest({ url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' }),
    ).resolves.toEqual({ error: '自定义音源需要在桌面应用中运行（浏览器环境没有本地源代理）' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
