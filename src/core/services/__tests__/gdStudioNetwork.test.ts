import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ proxy: vi.fn(), fetch: vi.fn() }));
vi.mock('../proxy', async (original) => ({ ...await original<typeof import('../proxy')>(), proxyFetch: mocks.proxy }));
beforeEach(() => { vi.resetModules(); mocks.proxy.mockReset(); mocks.fetch.mockReset().mockResolvedValue(new Response('1783745000')); vi.stubGlobal('fetch', mocks.fetch); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('GD 签名请求和服务端校时', () => {
  it('先校时再签名，请求数据正常解码并复用校时结果', async () => {
    const client = await import('../gdStudioClient');
    mocks.proxy.mockImplementation(async () => new Response(JSON.stringify([{ id: 1 }])));
    await expect(client.fetchGDStudioData({ types: 'search', name: '歌曲' })).resolves.toEqual([{ id: 1 }]);
    await client.fetchGDStudioData({ types: 'search', name: '其他' }); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.proxy.mock.lastCall![1].body).toContain('s='); expect(mocks.proxy.mock.lastCall![1].method).toBe('POST');
    expect(client.tryParseJson('invalid')).toBeNull(); expect(client.decodeResponseText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]).buffer)).toBe('中文');
    const Decoder = TextDecoder;
    vi.stubGlobal('TextDecoder', class extends Decoder { constructor(label?: string) { if (label === 'gb18030') throw new Error('unsupported'); super(label); } });
    expect(client.decodeResponseText(new TextEncoder().encode('中文').buffer as ArrayBuffer)).toBe('中文');
  });
  it.each([['bad', 200, 'BAD_RESPONSE'], ['0', 200, 'BAD_RESPONSE'], ['slow', 429, 'RATE_LIMIT']])('校时异常 %s 按类型向上传递', async (body, status, code) => {
    mocks.fetch.mockResolvedValueOnce(new Response(String(body), { status: Number(status) }));
    const client = await import('../gdStudioClient'); await expect(client.fetchGDStudioData({ types: 'search' })).rejects.toMatchObject({ code });
    expect(mocks.proxy).not.toHaveBeenCalled();
  });
  it('校时网络失败和外部取消不会继续代理请求', async () => {
    const client = await import('../gdStudioClient'); mocks.fetch.mockRejectedValue(new Error('offline'));
    await expect(client.fetchGDStudioData({ types: 'search' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const controller = new AbortController(); controller.abort(new Error('已取消'));
    await expect(client.fetchGDStudioData({ types: 'search' }, controller.signal)).rejects.toThrow('已取消');
  });
  it('代理网络错误、空响应、HTTP 错误及错误载荷不当成成功数据', async () => {
    const client = await import('../gdStudioClient'); await client.syncServerTime();
    for (const [body, status, code] of [['<html>error', 200, 'BAD_RESPONSE'], ['busy', 503, 'UNAVAILABLE'], ['{"detail":"rate limit"}', 200, 'RATE_LIMIT'], ['{"error":"source is not supported"}', 400, 'UNSUPPORTED_SOURCE']]) {
      mocks.proxy.mockResolvedValueOnce(new Response(String(body), { status: Number(status) }));
      await expect(client.fetchGDStudioData({ types: 'search' })).rejects.toMatchObject({ code });
    }
    mocks.proxy.mockResolvedValueOnce(null); await expect(client.fetchGDStudioData({ types: 'search' })).rejects.toThrow('empty proxy response');
    mocks.proxy.mockRejectedValueOnce(new Error('offline')); await expect(client.fetchGDStudioData({ types: 'search' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const expected = new client.GDStudioApiError('RATE_LIMIT', 429, 'busy'); mocks.proxy.mockRejectedValueOnce(expected);
    await expect(client.fetchGDStudioData({ types: 'search' })).rejects.toBe(expected);
  });
});
