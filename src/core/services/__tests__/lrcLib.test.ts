import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceResolveRequest } from '../sources/types';

const fetchMock = vi.fn<typeof fetch>();
const lrc = '[00:01]你好\n[00:03]世界';
const request = (extra: Partial<SourceResolveRequest> = {}): SourceResolveRequest => ({
  platform: 'qq', id: 'id', quality: '320k', name: '你好', artist: '甲', album: '原专辑', durationSeconds: 120, ...extra,
});
const record = (extra: Record<string, unknown> = {}) => ({
  trackName: '你好', artistName: '甲', albumName: '原专辑', duration: 120, syncedLyrics: lrc, ...extra,
});
const json = (value: unknown) => new Response(JSON.stringify(value));
let fetchLrcLibLyrics: typeof import('../lrcLib').fetchLrcLibLyrics;

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(10000);
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  ({ fetchLrcLibLyrics } = await import('../lrcLib'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('免费 LRCLIB严格兜底', () => {
  it('精确查询有时长和专辑，直接跨域、无凭据，成功结果缓存', async () => {
    fetchMock.mockResolvedValueOnce(json(record()));
    expect(await fetchLrcLibLyrics(request())).toBe(lrc);
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe('/api/get');
    expect(new URL(String(url)).searchParams.get('duration')).toBe('120');
    expect(new URL(String(url)).searchParams.get('album_name')).toBe('原专辑');
    expect(options).toMatchObject({ credentials: 'omit', signal: expect.any(AbortSignal) });
    expect(options?.headers).toBeUndefined();
    expect(await fetchLrcLibLyrics(request())).toBe(lrc);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('精确记录不合格时搜索，过滤错歌/版本/歌手/时长/plainLyrics，专辑优先再时长', async () => {
    fetchMock.mockResolvedValueOnce(json(record({ trackName: '你好 (Live)' }))).mockResolvedValueOnce(json([
      null, 42, record({ trackName: '你好呀' }), record({ artistName: '乙' }),
      record({ duration: 123 }), record({ duration: 0 }), record({ instrumental: true }),
      record({ syncedLyrics: null, plainLyrics: lrc, hasWordSync: true, lyricsfile: 'some-file' }),
      record({ syncedLyrics: '[03:00]超时一\n[03:30]超时二' }),
      record({ albumName: '精选', syncedLyrics: '[00:01]精选' }),
      record({ duration: 122, syncedLyrics: '[00:01]同专辑较远' }),
      record({ duration: 121, syncedLyrics: ' [00:01]同专辑最近 ' }),
    ]));
    expect(await fetchLrcLibLyrics(request())).toBe('[00:01]同专辑最近');
    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.has('duration')).toBe(false);
    expect(url.searchParams.has('album_name')).toBe(false);
  });

  it('缺少真实身份/有效时长时不联网，取消原因直接传播', async () => {
    for (const patch of [{ name: '' }, { artist: '' }, { name: 'Unknown Song' }, { artist: '未知歌手' },
      { durationSeconds: undefined }, { durationSeconds: Infinity }, { durationSeconds: -1 }]) {
      expect(await fetchLrcLibLyrics(request(patch))).toBe('');
    }
    const controller = new AbortController(); controller.abort(new Error('取消外部歌词'));
    await expect(fetchLrcLibLyrics(request({ signal: controller.signal }))).rejects.toThrow('取消外部歌词');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP失败释放body，空结果短缓存，forceRefresh能恢复且清除旧负缓存', async () => {
    const bad = new Response('missing', { status: 404 });
    const cancel = vi.spyOn(bad.body!, 'cancel');
    fetchMock.mockResolvedValueOnce(bad).mockResolvedValueOnce(json([]));
    expect(await fetchLrcLibLyrics(request({ album: undefined }))).toBe('');
    expect(cancel).toHaveBeenCalledOnce();
    expect(await fetchLrcLibLyrics(request({ album: undefined }))).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(json(record()));
    expect(await fetchLrcLibLyrics(request({ album: undefined, forceRefresh: true }))).toBe(lrc);
    expect(await fetchLrcLibLyrics(request({ album: undefined }))).toBe(lrc);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('强制刷新失败移除旧成功缓存，正常TTL到期也会重查', async () => {
    fetchMock.mockImplementation(async () => json(record()));
    expect(await fetchLrcLibLyrics(request())).toBe(lrc);
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);
    expect(await fetchLrcLibLyrics(request())).toBe(lrc);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation(async () => json(null));
    expect(await fetchLrcLibLyrics(request({ forceRefresh: true }))).toBe('');
    expect(await fetchLrcLibLyrics(request())).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1);
    expect(await fetchLrcLibLyrics(request())).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('畸形JSON和网络错误降级，外部取消不会缓存为缺失', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{broken')).mockRejectedValueOnce(new Error('offline'));
    expect(await fetchLrcLibLyrics(request())).toBe('');
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));
    const result = fetchLrcLibLyrics(request({ name: '取消请求', signal: controller.signal }));
    const rejected = expect(result).rejects.toThrow('用户停止');
    controller.abort(new Error('用户停止'));
    await rejected;
    fetchMock.mockResolvedValue(json(record({ trackName: '取消请求' })));
    expect(await fetchLrcLibLyrics(request({ name: '取消请求' }))).toBe(lrc);
  });

  it('每个请求有5秒界限，超时后搜索仍可恢复同步LRC', async () => {
    fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    })).mockResolvedValueOnce(json([record()]));
    const pending = fetchLrcLibLyrics(request());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(lrc);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('缓存保留精确时长，近边界不同请求不能共享不合格记录', async () => {
    fetchMock.mockImplementation(async () => json(record({ duration: 122.4 })));
    expect(await fetchLrcLibLyrics(request({ durationSeconds: 120.49 }))).toBe(lrc);
    expect(await fetchLrcLibLyrics(request({ durationSeconds: 120.1 }))).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
