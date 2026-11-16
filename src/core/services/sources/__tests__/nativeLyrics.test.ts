import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../__tests__/deferred';
const native = vi.hoisted(() => vi.fn());
vi.mock('../../netease', () => ({ fetchNeteaseLyrics: native }));
vi.mock('../../qq', () => ({ fetchQQLyrics: native }));
vi.mock('../../kuwo', () => ({ fetchKuwoLyrics: native }));
let fetchNativeLyrics: typeof import('../nativeLyrics').fetchNativeLyrics;
beforeEach(async () => {
  vi.resetModules(); native.mockReset();
  ({ fetchNativeLyrics } = await import('../nativeLyrics'));
});
afterEach(() => vi.restoreAllMocks());
describe('原生歌词缓存取消与强刷', () => {
  it('已取消请求即使有成功缓存也传播原因，不向平台发请求', async () => {
    native.mockResolvedValue('[00:01]缓存歌词');
    expect(await fetchNativeLyrics(1, 'qq')).toBe('[00:01]缓存歌词');
    const controller = new AbortController(); controller.abort(new Error('停止请求'));
    await expect(fetchNativeLyrics(1, 'qq', { signal: controller.signal })).rejects.toThrow('停止请求');
    expect(native).toHaveBeenCalledOnce();
  });
  it('不遵循signal的原生端点迟到返回不能进入缓存，新请求可恢复', async () => {
    const late = deferred<string>(); native.mockReturnValueOnce(late.promise);
    const controller = new AbortController();
    const pending = fetchNativeLyrics(1, 'netease', { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow('取消旧请求');
    controller.abort(new Error('取消旧请求')); late.resolve('[00:01]旧歌词'); await rejected;
    native.mockResolvedValue('[00:01]新歌词');
    expect(await fetchNativeLyrics(1, 'netease')).toBe('[00:01]新歌词'); expect(native).toHaveBeenCalledTimes(2);
  });
  it('强刷空结果淘汰旧成功缓存，缺失不永久缓存', async () => {
    native.mockResolvedValueOnce('[00:01]旧歌词').mockResolvedValueOnce('').mockResolvedValueOnce('[00:01]已恢复');
    expect(await fetchNativeLyrics(1, 'kuwo')).toBe('[00:01]旧歌词');
    expect(await fetchNativeLyrics(1, 'kuwo', { forceRefresh: true })).toBe('');
    expect(await fetchNativeLyrics(1, 'kuwo')).toBe('[00:01]已恢复'); expect(native).toHaveBeenCalledTimes(3);
  });
  it('旧失败请求结束不能清除强刷中的新请求，并发调用复用新请求', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = deferred<string>(), latest = deferred<string>();
    native.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    const old = fetchNativeLyrics(1, 'qq'), fresh = fetchNativeLyrics(1, 'qq', { forceRefresh: true });
    first.reject(new Error('旧请求失败')); expect(await old).toBe('');
    const shared = fetchNativeLyrics(1, 'qq'); expect(native).toHaveBeenCalledTimes(2);
    latest.resolve('[00:01]新请求'); expect(await fresh).toBe('[00:01]新请求'); expect(await shared).toBe('[00:01]新请求');
  });
  it('原生异常与不支持来源安全降级，取消异常保留原始原因', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await fetchNativeLyrics(1, 'unknown')).toBe('');
    native.mockRejectedValueOnce(new Error('接口离线'));
    expect(await fetchNativeLyrics(1, 'netease')).toBe(''); expect(console.warn).toHaveBeenCalled();
    const controller = new AbortController(); native.mockImplementationOnce(async () => {
      controller.abort('停止'); throw new Error('network abort');
    });
    await expect(fetchNativeLyrics(1, 'netease', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
