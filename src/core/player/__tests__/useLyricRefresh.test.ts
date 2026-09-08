import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../services/api', () => ({ getLyrics: vi.fn() }));
vi.mock('../../services/gdStudio', () => ({ isGDStudioSource: () => true, resolveGDStudioPic: vi.fn() }));
import { getLyrics } from '../../services/api';
import { resolveGDStudioPic } from '../../services/gdStudio';
import { useLyricRefresh } from '../useLyricRefresh';
import { createRuntimeDouble, song } from './playerTestDoubles';
import { LYRIC_DISPLAY_MODE_STORAGE_KEY } from '../../utils/lyricDisplayMode';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getLyrics).mockResolvedValue('');
  vi.mocked(resolveGDStudioPic).mockResolvedValue('');
});
afterEach(cleanup);

describe('播放后的歌词和封面补充', () => {
  it('跨窗口歌词模式变更和清空存储会重新请求，其它存储键不影响播放', async () => {
    const { runtime } = createRuntimeDouble({ currentSong: song('1', { url: 'https://example.com/audio.mp3' }) });
    renderHook(() => useLyricRefresh(runtime)); await act(async () => {});
    expect(getLyrics).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' })));
    expect(getLyrics).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: LYRIC_DISPLAY_MODE_STORAGE_KEY })));
    await act(async () => {}); expect(getLyrics).toHaveBeenCalledTimes(2);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    await act(async () => {}); expect(getLyrics).toHaveBeenCalledTimes(3);
    expect(vi.mocked(getLyrics).mock.lastCall?.[3]?.forceRefresh).toBe(true);
  });

  it('播放地址尚未就绪时不占用歌词和封面请求', () => {
    const { runtime } = createRuntimeDouble({ currentSong: song('1') });
    renderHook(() => useLyricRefresh(runtime));
    expect(getLyrics).not.toHaveBeenCalled();
    expect(resolveGDStudioPic).not.toHaveBeenCalled();
  });

  it('跨源解析后使用实际音源身份并保持曲库原始身份', async () => {
    const current = song('original', { url: 'https://example.com/audio.mp3', picId: 'old-pic' });
    const { runtime, refs } = createRuntimeDouble({ currentSong: current, queue: [current] });
    refs.lyricBindings.current.set('netease:original', {
      source: 'qq', id: 'actual-song', lyricId: 'actual-lyric', picId: 'actual-pic',
    });
    vi.mocked(getLyrics).mockResolvedValue('[00:01.00]歌词');
    vi.mocked(resolveGDStudioPic).mockResolvedValue('https://example.com/cover.jpg');
    renderHook(() => useLyricRefresh(runtime));
    await waitFor(() => expect(refs.currentSong.current?.pic).toContain('cover.jpg'));
    expect(getLyrics).toHaveBeenCalledWith('actual-song', 'qq', expect.objectContaining({
      lyricId: 'actual-lyric', picId: 'actual-pic',
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(resolveGDStudioPic).toHaveBeenCalledWith('actual-song', 'qq', expect.objectContaining({ picId: 'actual-pic' }), expect.any(AbortSignal));
    expect(refs.currentSong.current).toMatchObject({ id: 'original', source: 'netease', lrc: '[00:01.00]歌词' });
  });

  it('切歌取消旧请求，迟到的歌词和封面不能写入新歌曲', async () => {
    let finishLyrics: (value: string) => void = () => {};
    let finishCover: (value: string) => void = () => {};
    vi.mocked(getLyrics).mockImplementationOnce(() => new Promise((resolve) => { finishLyrics = resolve; }));
    vi.mocked(resolveGDStudioPic).mockImplementationOnce(() => new Promise((resolve) => { finishCover = resolve; }));
    const original = song('old', { url: 'https://example.com/old.mp3' });
    const { runtime, refs, commitCurrentSong } = createRuntimeDouble({ currentSong: original });
    const view = renderHook(({ value }) => useLyricRefresh(value), { initialProps: { value: runtime } });
    const signal = vi.mocked(getLyrics).mock.calls[0][3]?.signal;
    const next = song('new');
    refs.currentSong.current = next;
    refs.playRequestId.current += 1;
    view.rerender({ value: { ...runtime, currentSong: next } });
    expect(signal?.aborted).toBe(true);
    await act(async () => { finishLyrics('[00:01.00]旧歌词'); finishCover('https://example.com/old.jpg'); });
    expect(commitCurrentSong).not.toHaveBeenCalled();
    expect(refs.currentSong.current).toEqual(next);
  });

  it('同曲播放请求被取消后，新的请求仍能补充元数据', async () => {
    const original = song('same', { url: 'https://example.com/audio.mp3' });
    const { runtime, refs } = createRuntimeDouble({ currentSong: original });
    refs.playAbort.current = new AbortController();
    vi.mocked(getLyrics).mockImplementationOnce(() => new Promise(() => {}));
    const view = renderHook(({ value }) => useLyricRefresh(value), { initialProps: { value: runtime } });
    const oldSignal = vi.mocked(getLyrics).mock.calls[0][3]?.signal;
    refs.playAbort.current.abort();
    refs.playAbort.current = new AbortController();
    refs.playRequestId.current += 1;
    vi.mocked(getLyrics).mockResolvedValue('[00:01.00]新歌词');
    view.rerender({ value: { ...runtime, currentSong: { ...original } } });
    expect(oldSignal?.aborted).toBe(true);
    await waitFor(() => expect(refs.currentSong.current?.lrc).toContain('新歌词'));
    expect(getLyrics).toHaveBeenCalledTimes(2);
  });
});
