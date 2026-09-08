import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeDouble, song } from './playerTestDoubles';
import { useQueueControls } from '../useQueueControls';
import type { AudioLifecycle } from '../useAudioLifecycle';
import type { PlaybackControls } from '../usePlaybackControls';
import type { RecommendationPlayback } from '../useRecommendationPlayback';
import type { SongResolver } from '../useSongResolver';
import type { PlayMode } from '../../types';

const handlers = new Map<string, MediaSessionActionHandler | null>();
const harness = () => {
  const h = createRuntimeDouble({ queue: [song('1'), song('2'), song('3')], currentSong: song('1') });
  const audio = { updateMediaSession: vi.fn(), updateCurrentTimeState: vi.fn(), updatePositionState: vi.fn() } as unknown as AudioLifecycle;
  const playback = { resumePlayback: vi.fn().mockResolvedValue(undefined), pausePlayback: vi.fn(), seek: vi.fn() } as unknown as PlaybackControls;
  const recommendation = { logEarlySkipIfNeeded: vi.fn(), startPlaybackSession: vi.fn() } as unknown as RecommendationPlayback;
  const resolver = { preloadNextSong: vi.fn() } as unknown as SongResolver;
  return { ...h, audioLifecycle: audio, playback, recommendation, resolver,
    mount: () => renderHook(() => useQueueControls(h.runtime, audio, playback, recommendation, resolver)) };
};
beforeEach(() => {
  handlers.clear(); Object.defineProperty(navigator, 'mediaSession', { configurable: true,
    value: { metadata: { title: 'test' }, playbackState: 'playing', setActionHandler: (name: string, action: MediaSessionActionHandler | null) => handlers.set(name, action) } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'mediaSession'); });

describe('队列播放与媒体控制', () => {
  it('整单播放去重，选中在播歌曲只更新元数据，暂停歌曲重新交给播放入口', async () => {
    const h = harness(); const { result } = h.mount();
    await act(() => result.current.playQueue([])); expect(h.refs.playSong.current).not.toHaveBeenCalled();
    await act(() => result.current.playQueue([song('1'), song('1'), song('2')], song('2')));
    expect(h.refs.queue.current.map((item) => item.id)).toEqual(['1', '2']); expect(h.refs.playSong.current).toHaveBeenLastCalledWith(song('2'));
    h.audio.src = 'https://audio.test/1.mp3'; h.audio.paused = false;
    const updated = song('1', { name: '更新标题' });
    await act(() => result.current.playQueue([updated, song('2')]));
    expect(h.refs.currentSong.current?.name).toBe('更新标题'); expect(h.resolver.preloadNextSong).toHaveBeenCalledWith(updated);
    h.audio.paused = true; await act(() => result.current.playQueue([song('1')], song('missing')));
    expect(h.refs.playSong.current).toHaveBeenLastCalledWith(song('1'));
  });

  it('单曲循环重播不解析，手动下一首记录跳过，仅剩一首时开启新会话', async () => {
    const h = harness(); const { result } = h.mount(); h.refs.playMode.current = 'loop'; h.audio.currentTime = 70;
    act(() => result.current.playNext(false)); expect(h.audio.currentTime).toBe(0); expect(h.audio.play).toHaveBeenCalledOnce();
    expect(h.recommendation.logEarlySkipIfNeeded).not.toHaveBeenCalled();
    h.audio.play.mockRejectedValueOnce(new Error('autoplay')); vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => result.current.playNext(false)); await act(async () => {}); expect(console.error).toHaveBeenCalled();
    h.refs.playMode.current = 'sequence'; act(() => result.current.playNext());
    expect(h.refs.playSong.current).toHaveBeenLastCalledWith(song('2')); expect(h.recommendation.logEarlySkipIfNeeded).toHaveBeenCalledOnce();
    h.refs.queue.current = [song('1')]; h.refs.refreshedCacheKeys.current.add('stale'); act(() => result.current.playNext());
    expect(h.refs.playSong.current).toHaveBeenLastCalledWith(song('1'), '320k');
    expect(h.recommendation.startPlaybackSession).toHaveBeenCalledOnce(); expect(h.refs.refreshedCacheKeys.current.size).toBe(0);
    h.refs.queue.current = []; act(() => { result.current.playNext(); result.current.playPrev(); });
  });

  it('移除当前项选中相邻歌曲，最后一首删除时清理请求、音源和系统媒体信息', () => {
    const h = harness(); h.refs.currentSong.current = song('2'); const { result } = h.mount();
    act(() => result.current.removeFromQueue('missing')); expect(h.queueWrites()).toBe(0);
    act(() => result.current.removeFromQueue('1', 'netease')); expect(h.refs.playSong.current).not.toHaveBeenCalled();
    act(() => result.current.removeFromQueue('2', 'netease')); expect(h.refs.playSong.current).toHaveBeenCalledWith(song('3'));
    h.refs.currentSong.current = song('3'); h.refs.playAbort.current = new AbortController(); const signal = h.refs.playAbort.current.signal;
    act(() => result.current.removeFromQueue('3'));
    expect(signal.aborted).toBe(true); expect(h.refs.queue.current).toEqual([]); expect(h.refs.currentSong.current).toBeNull();
    expect(h.audio.pause).toHaveBeenCalledOnce(); expect(h.audio.load).toHaveBeenCalledOnce();
    expect(h.setDuration).toHaveBeenCalledWith(0); expect(h.setIsLoading).toHaveBeenCalledWith(false);
    expect(navigator.mediaSession.metadata).toBeNull(); expect(navigator.mediaSession.playbackState).toBe('none');
  });

  it('清空保留在播歌曲，播放模式循环，系统媒体按钮转发对应操作并在卸载解绑', async () => {
    const h = harness(); const { result, unmount } = h.mount();
    act(() => result.current.clearQueue()); expect(h.refs.queue.current).toEqual([song('1')]);
    h.refs.currentSong.current = null; act(() => result.current.clearQueue()); expect(h.refs.queue.current).toEqual([]);
    const modes: PlayMode[] = []; vi.mocked(h.runtime.setPlayMode).mockImplementation((update) => {
      h.refs.playMode.current = typeof update === 'function' ? update(h.refs.playMode.current) : update;
      modes.push(h.refs.playMode.current);
    });
    act(() => { result.current.togglePlayMode(); result.current.togglePlayMode(); result.current.togglePlayMode(); });
    expect(modes).toEqual(['loop', 'shuffle', 'sequence']);
    act(() => {
      handlers.get('play')?.({ action: 'play' }); handlers.get('pause')?.({ action: 'pause' });
      handlers.get('previoustrack')?.({ action: 'previoustrack' }); handlers.get('nexttrack')?.({ action: 'nexttrack' });
      handlers.get('seekto')?.({ action: 'seekto' }); handlers.get('seekto')?.({ action: 'seekto', seekTime: 42 });
    }); await act(async () => {});
    expect(h.playback.resumePlayback).toHaveBeenCalledOnce(); expect(h.playback.pausePlayback).toHaveBeenCalledOnce(); expect(h.playback.seek).toHaveBeenCalledWith(42);
    unmount(); expect([...handlers.values()].every((handler) => handler === null)).toBe(true);
  });
});
