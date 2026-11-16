import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../__tests__/deferred';
import type { Song } from '../../types';
import type { SourceResolveRequest } from '../sources/types';
vi.mock('../sources/registry', () => ({ fallbackPlatformsFor: vi.fn(), searchSongs: vi.fn(), resolveLyrics: vi.fn() }));
vi.mock('../lrcLib', () => ({ fetchLrcLibLyrics: vi.fn() }));
import { fallbackPlatformsFor, searchSongs, resolveLyrics } from '../sources/registry';
import { fetchLrcLibLyrics } from '../lrcLib';
import { resolveLyricFallback } from '../lyricsFallback';
import { invalidatePlayback } from '../sources/generation';

const line = '[00:01]你好\n[00:03]世界';
const word = '[1000,1000](1000,500,0)你(1500,500,0)好\n[3000,1000](3000,500,0)世(3500,500,0)界';
let count = 0;
let input: SourceResolveRequest;
const song = (patch: Partial<Song> = {}): Song => ({
  id: 'matched', source: 'qq', name: '你好', artist: '甲', album: '专辑', durationSeconds: 120, ...patch,
});
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  input = { platform: 'netease', id: `id-${++count}`, quality: '320k', name: '你好', artist: '甲', album: '专辑', durationSeconds: 120 };
  vi.mocked(fallbackPlatformsFor).mockReturnValue(['qq', 'kuwo']);
  vi.mocked(searchSongs).mockResolvedValue([]);
  vi.mocked(resolveLyrics).mockResolvedValue('');
  vi.mocked(fetchLrcLibLyrics).mockResolvedValue('');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('已核验录音的歌词补全顺序', () => {
  it('已有可用真实逐字时短路；没有身份/时长时保留原文本且不联网', async () => {
    expect(await resolveLyricFallback(input, word)).toBe(word);
    for (const patch of [{ name: '' }, { artist: '' }, { artist: 'Unknown Artist' }, { durationSeconds: 0 }, { durationSeconds: undefined }]) {
      expect(await resolveLyricFallback({ ...input, ...patch }, line)).toBe(line);
    }
    expect(searchSongs).not.toHaveBeenCalled(); expect(fetchLrcLibLyrics).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort('stop');
    await expect(resolveLyricFallback({ ...input, signal: controller.signal }, '')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('候选完整标题、全部歌手、版本、时长都必须通过，并优先同专辑', async () => {
    vi.mocked(searchSongs).mockImplementation(async (_query, platform) => platform === 'qq' ? [
      song({ id: 'wrong-title', name: '你好呀' }), song({ id: 'live', name: '你好 (Live)' }),
      song({ id: 'wrong-artist', artist: '甲, 乙' }), song({ id: 'wrong-duration', durationSeconds: 124 }),
      song({ id: 'unknown-duration', durationSeconds: undefined }), song({ id: 'collection', album: '精选' }),
      song({ id: 'same-album', lyricId: 'lyric-id' }),
    ] : []);
    vi.mocked(resolveLyrics).mockResolvedValue(word);
    expect(await resolveLyricFallback(input, line)).toBe(word);
    expect(resolveLyrics).toHaveBeenCalledOnce();
    expect(resolveLyrics).toHaveBeenCalledWith(expect.objectContaining({ platform: 'qq', id: 'same-album', lyricId: 'lyric-id',
      durationSeconds: 120, quality: '320k', signal: expect.any(AbortSignal) }));
    expect(fetchLrcLibLyrics).not.toHaveBeenCalled();
  });

  it('先到普通LRC不会取消较慢来源的真实逐字轨', async () => {
    const slow = deferred<string>();
    vi.mocked(searchSongs).mockImplementation(async (_query, platform) => [song({ source: platform })]);
    vi.mocked(resolveLyrics).mockImplementation(async (request) => request.platform === 'qq' ? line : slow.promise);
    let finished = false;
    const pending = resolveLyricFallback(input, '').then((value) => { finished = true; return value; });
    await flush(); expect(finished).toBe(false);
    slow.resolve(word);
    expect(await pending).toBe(word);
    expect(fetchLrcLibLyrics).not.toHaveBeenCalled();
  });

  it('普通跨平台候选全部完成后保留最佳逐行结果，错词不替换', async () => {
    vi.mocked(searchSongs).mockImplementation(async (_query, platform) => [song({ source: platform })]);
    vi.mocked(resolveLyrics).mockImplementation(async (request) => request.platform === 'qq' ? line : '[1000,1000](1000,1000,0)另一首');
    expect(await resolveLyricFallback(input, '')).toBe(line);
    expect(fetchLrcLibLyrics).not.toHaveBeenCalled();
  });

  it('平台无同步歌词才到外部LRCLIB，空外部结果保留纯文本', async () => {
    vi.mocked(fetchLrcLibLyrics).mockResolvedValueOnce(line);
    expect(await resolveLyricFallback(input, '接口维护中')).toBe(line);
    expect(fetchLrcLibLyrics).toHaveBeenCalledWith(input);
    expect(await resolveLyricFallback({ ...input, id: 'missing' }, '纯文本')).toBe('纯文本');
    expect(fetchLrcLibLyrics).toHaveBeenCalledTimes(2);
  });

  it('缓存区分音源配置代数，forceRefresh不复用；同结果按10分钟过期', async () => {
    vi.mocked(fetchLrcLibLyrics).mockResolvedValue(line);
    expect(await resolveLyricFallback(input, '')).toBe(line);
    expect(await resolveLyricFallback(input, '')).toBe(line);
    expect(fetchLrcLibLyrics).toHaveBeenCalledOnce();
    await resolveLyricFallback({ ...input, forceRefresh: true }, '');
    expect(fetchLrcLibLyrics).toHaveBeenCalledTimes(2);
    invalidatePlayback(); await resolveLyricFallback(input, '');
    expect(fetchLrcLibLyrics).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(600001); await resolveLyricFallback(input, '');
    expect(fetchLrcLibLyrics).toHaveBeenCalledTimes(4);
  });

  it('单个平台失败不妨碍另一候选或外部降级，每个平台最多试两首', async () => {
    vi.mocked(searchSongs).mockImplementation(async (_query, platform) => {
      if (platform === 'qq') throw new Error('服务不可用');
      return ['1', '2', '3'].map((id) => song({ source: platform, id }));
    });
    vi.mocked(resolveLyrics).mockResolvedValue('');
    vi.mocked(fetchLrcLibLyrics).mockResolvedValue(line);
    expect(await resolveLyricFallback(input, '')).toBe(line);
    expect(resolveLyrics).toHaveBeenCalledTimes(2);
  });

  it('总计6.5秒超时会取消worker并降级，迟到候选不能写缓存', async () => {
    const slow = deferred<Song[]>();
    vi.mocked(searchSongs).mockImplementation(async (_query, platform) => platform === 'qq' ? slow.promise : []);
    vi.mocked(fetchLrcLibLyrics).mockResolvedValue(line);
    vi.mocked(resolveLyrics).mockResolvedValue(word);
    const pending = resolveLyricFallback(input, '');
    await vi.advanceTimersByTimeAsync(6500);
    expect(await pending).toBe(line);
    const signal = vi.mocked(searchSongs).mock.calls[0][4]; expect(signal?.aborted).toBe(true);
    slow.resolve([song()]); await flush(); expect(resolveLyrics).not.toHaveBeenCalled();
    expect(await resolveLyricFallback(input, '')).toBe(line);
  });

  it('调用方取消中断在途搜索/歌词/外部结果，不缓存空结果', async () => {
    const pendingLyrics = deferred<string>();
    vi.mocked(searchSongs).mockResolvedValue([song()]);
    vi.mocked(resolveLyrics).mockReturnValue(pendingLyrics.promise);
    const controller = new AbortController();
    const pending = resolveLyricFallback({ ...input, signal: controller.signal }, line);
    await flush();
    const rejected = expect(pending).rejects.toThrow('取消歌词');
    controller.abort(new Error('取消歌词')); await rejected;
    pendingLyrics.resolve(word); await flush();
    expect(fetchLrcLibLyrics).not.toHaveBeenCalled();
    vi.mocked(searchSongs).mockResolvedValue([]);
    const external = deferred<string>(); vi.mocked(fetchLrcLibLyrics).mockReturnValue(external.promise);
    const second = new AbortController();
    const waiting = resolveLyricFallback({ ...input, id: 'external', signal: second.signal }, '');
    await flush(); second.abort(new Error('取消外部'));
    external.resolve(line); await expect(waiting).rejects.toThrow('取消外部');
  });
});
