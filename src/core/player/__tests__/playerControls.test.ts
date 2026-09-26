import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackControls } from '../usePlaybackControls';
import { MAX_CONSECUTIVE_SONG_FAILURES, MAX_URL_REFRESHES, usePlaybackRecovery } from '../usePlaybackRecovery';
import { usePlayerSettingsActions } from '../usePlayerSettingsActions';
import { useRecommendationPlayback } from '../useRecommendationPlayback';
import { createRuntimeDouble, deferred, song } from './playerTestDoubles';
import type { AudioLifecycle } from '../useAudioLifecycle';
import type { RecommendationPlayback } from '../useRecommendationPlayback';
import type { SongResolver } from '../useSongResolver';

const logEvent = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../services/recommendation', () => ({ logRecommendationEvent: logEvent }));

const harness = (current = song('a')) => {
  const double = createRuntimeDouble({ currentSong: current, queue: [current] });
  const audio = {
    updateMediaSession: vi.fn(), updateCurrentTimeState: vi.fn(), updatePositionState: vi.fn(),
    syncPlaybackTime: vi.fn(), clearActiveAudioSource: vi.fn(),
  } as unknown as AudioLifecycle;
  const recommendation = {
    showPlayerNotice: vi.fn(), logEarlySkipIfNeeded: vi.fn(), startPlaybackSession: vi.fn(),
    logPlaybackEvent: vi.fn(), resetPlaybackState: vi.fn(),
  } as unknown as RecommendationPlayback;
  const resolver = { preloadNextSong: vi.fn() } as unknown as SongResolver;
  const recovery = { evictActiveParsedSong: vi.fn() } as unknown as ReturnType<typeof usePlaybackRecovery>;
  const mount = () => renderHook(() => usePlaybackControls(double.runtime, audio, resolver, recommendation, recovery));
  return { ...double, audioLifecycle: audio, recommendation, resolver, recovery, mount };
};

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('播放控制的真实状态边界', () => {
  it('暂停使在途请求失效，继续播放同步媒体会话与预加载', async () => {
    const h = harness(); h.audio.src = 'https://audio.test/a.mp3';
    const { result } = h.mount();
    act(() => result.current.pausePlayback());
    expect(h.refs.playRequestId.current).toBe(1);
    expect(h.audio.pause).toHaveBeenCalledOnce();
    expect(h.audioLifecycle.updateMediaSession).toHaveBeenCalledWith(song('a'), 'paused');
    await act(() => result.current.resumePlayback());
    expect(h.audio.play).toHaveBeenCalledOnce();
    expect(h.setIsPlaying).toHaveBeenLastCalledWith(true);
    expect(h.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(h.resolver.preloadNextSong).toHaveBeenCalledWith(song('a'));
    expect(h.audioLifecycle.syncPlaybackTime).toHaveBeenCalledWith(true);
  });

  it('缺少音频或歌曲时不触发播放、暂停和跳转', async () => {
    const h = harness(); const { result } = h.mount();
    h.refs.audio.current = null; h.refs.currentSong.current = null;
    act(() => { result.current.pausePlayback(); result.current.togglePlay(); result.current.seek(25); });
    await act(() => result.current.resumePlayback());
    expect(h.audio.play).not.toHaveBeenCalled();
    expect(h.refs.playSong.current).not.toHaveBeenCalled();
    expect(h.audioLifecycle.updatePositionState).not.toHaveBeenCalled();
  });

  it('音质变更和空音源都通过统一播放入口重新解析', async () => {
    const h = harness(); const { result } = h.mount();
    h.refs.pendingQualityChange.current = true; h.refs.audioQuality.current = 'flac';
    await act(() => result.current.resumePlayback());
    expect(h.refs.playSong.current).toHaveBeenLastCalledWith(song('a'), 'flac');
    h.refs.pendingQualityChange.current = false;
    await act(() => result.current.resumePlayback());
    expect(h.refs.playSong.current).toHaveBeenLastCalledWith(song('a'));
    h.audio.src = window.location.href;
    await act(() => result.current.resumePlayback());
    expect(h.audio.play).not.toHaveBeenCalled();
  });

  it('恢复暂停的音频上下文，并通过当前播放状态切换与 seek', async () => {
    const h = harness(); h.audio.src = 'https://audio.test/a.mp3';
    const resume = vi.fn(() => Promise.resolve());
    h.refs.audioContext.current = { state: 'suspended', resume } as unknown as AudioContext;
    const { result } = h.mount();
    await act(() => result.current.resumePlayback());
    expect(resume).toHaveBeenCalledOnce();
    act(() => result.current.seek(42));
    expect(h.audio.currentTime).toBe(42);
    expect(h.audioLifecycle.updatePositionState).toHaveBeenCalledOnce();
    h.audio.paused = false;
    act(() => result.current.togglePlay());
    expect(h.audio.pause).toHaveBeenCalledOnce();
    await act(async () => { result.current.togglePlay(); });
    expect(h.audio.play).toHaveBeenCalledTimes(2);
  });

  it('自动播放被阻止时给出提示，普通播放失败则清理旧源再解析', async () => {
    const h = harness(); h.audio.src = 'https://audio.test/a.mp3';
    const { result } = h.mount();
    h.audio.play.mockRejectedValueOnce(new DOMException('需要用户手势', 'NotAllowedError'));
    await act(() => result.current.resumePlayback());
    expect(h.recommendation.showPlayerNotice).toHaveBeenCalledWith(expect.stringContaining('再次点击'), 'warning');
    expect(h.setIsPlaying).toHaveBeenLastCalledWith(false);
    h.audio.play.mockRejectedValueOnce(new Error('源已过期'));
    await act(() => result.current.resumePlayback());
    expect(h.recovery.evictActiveParsedSong).toHaveBeenCalledOnce();
    expect(h.audioLifecycle.clearActiveAudioSource).toHaveBeenCalledOnce();
    expect(h.refs.playSong.current).toHaveBeenCalledWith(song('a'));
  });

  it.each(['resolve', 'reject'] as const)('忽略被新请求替代的旧播放 %s', async (settle) => {
    const h = harness(); h.audio.src = 'https://audio.test/a.mp3';
    const pending = deferred<void>(); h.audio.play.mockReturnValueOnce(pending.promise);
    const { result } = h.mount();
    const run = result.current.resumePlayback(); h.refs.playRequestId.current += 1;
    if (settle === 'resolve') pending.resolve(); else pending.reject(new Error('过期响应'));
    await act(() => run);
    expect(h.setIsPlaying).not.toHaveBeenCalled();
    expect(h.recovery.evictActiveParsedSong).not.toHaveBeenCalled();
  });
});

describe('播放恢复阶梯', () => {
  it('过期缓存按上限刷新，每次记下放不了的地址，清理始终移除当前键', () => {
    const h = harness();
    const { result } = renderHook(() => usePlaybackRecovery(h.runtime, h.recommendation));
    expect(result.current.retryCachedSongResolution(song('a'), '320k')).toBe(false);
    h.refs.activeParsedCacheKey.current = 'netease:a:320k:3';
    h.refs.parsedSongCache.current.set('netease:a:320k:3', { data: {} as never, expiresAt: Infinity });
    h.audio.src = 'https://cdn.test/a.mp3';
    expect(result.current.retryCachedSongResolution(song('a'), '320k')).toBe(true);
    expect(h.refs.refreshedResolutions.current.get('netease:a:320k')).toEqual(['https://cdn.test/a.mp3']);
    expect(h.refs.parsedSongCache.current.has('netease:a:320k:3')).toBe(false);
    expect(h.refs.playSong.current).toHaveBeenCalledWith(song('a'), '320k');
    h.refs.activeParsedCacheKey.current = 'netease:a:320k:4'; h.audio.src = window.location.href;
    expect(result.current.retryCachedSongResolution(song('a'), '320k')).toBe(true);
    expect(h.refs.refreshedResolutions.current.get('netease:a:320k')).toEqual(['https://cdn.test/a.mp3', '']);
    h.refs.activeParsedCacheKey.current = 'netease:a:320k:5';
    expect(MAX_URL_REFRESHES).toBe(2);
    expect(result.current.retryCachedSongResolution(song('a'), '320k')).toBe(false);
    h.refs.activeParsedCacheKey.current = 'netease:ab:flac:3';
    expect(result.current.retryCachedSongResolution(song('a'), 'flac')).toBe(false);
    result.current.evictActiveParsedSong();
    expect(h.refs.activeParsedCacheKey.current).toBeNull();
  });

  it('推荐播放失败跳过同一批次失败项', () => {
    const first = song('a', { recommendationRequestId: 'batch' });
    const second = song('b', { recommendationRequestId: 'batch' });
    const h = harness(first); h.refs.queue.current = [first, song('plain'), second];
    const { result } = renderHook(() => usePlaybackRecovery(h.runtime, h.recommendation));
    expect(result.current.skipFailedSong(first)).toBe(true);
    expect(h.refs.playSong.current).toHaveBeenCalledWith(second);
    expect(result.current.skipFailedSong(second)).toBe(false);
    expect(h.refs.failedRecommendationSongKeys.current.size).toBe(2);
    expect(h.refs.failedQueueSongKeys.current.size).toBe(0);
  });

  it('普通歌曲失败按播放顺序跳过已失败项，整圈失败时停下', () => {
    const [a, b, c] = [song('a'), song('b'), song('c')];
    const h = harness(a); h.refs.queue.current = [a, b, c];
    const { result } = renderHook(() => usePlaybackRecovery(h.runtime, h.recommendation));
    h.refs.failedQueueSongKeys.current.add('netease:b');
    expect(result.current.skipFailedSong(a)).toBe(true);
    expect(h.refs.playSong.current).toHaveBeenLastCalledWith(c);
    expect(h.recommendation.showPlayerNotice).toHaveBeenLastCalledWith('《歌曲 a》暂时无法播放，已自动切到下一首', 'warning', 'songSkipped');
    expect(result.current.skipFailedSong(c)).toBe(false);
    expect(h.refs.playSong.current).toHaveBeenCalledOnce();
  });

  it('单曲循环与随机播放时同样跳到队列中的其它歌曲', () => {
    const [a, b] = [song('a'), song('b')];
    const h = harness(a); h.refs.queue.current = [a, b];
    const { result } = renderHook(() => usePlaybackRecovery(h.runtime, h.recommendation));
    h.refs.playMode.current = 'loop';
    expect(result.current.skipFailedSong(a)).toBe(true);
    expect(h.refs.playSong.current).toHaveBeenLastCalledWith(b);
    h.refs.failedQueueSongKeys.current.clear(); h.refs.playMode.current = 'shuffle';
    expect(result.current.skipFailedSong(b)).toBe(true);
    expect(h.refs.playSong.current).toHaveBeenLastCalledWith(a);
  });

  it('连续失败达到上限后停止跳过，提示检查音源并重新计数', () => {
    const songs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => song(id));
    const h = harness(songs[0]); h.refs.queue.current = songs;
    const { result } = renderHook(() => usePlaybackRecovery(h.runtime, h.recommendation));
    const onGiveUp = vi.fn();
    for (const [index, failing] of songs.slice(0, MAX_CONSECUTIVE_SONG_FAILURES).entries()) {
      h.refs.recoveryStage.current = 'initial';
      result.current.runRecovery({ song: failing, quality: '128k', trigger: 'missingUrl', canRetryWithoutCors: false, onGiveUp });
      if (index < MAX_CONSECUTIVE_SONG_FAILURES - 1) expect(h.refs.playSong.current).toHaveBeenLastCalledWith(songs[index + 1]);
    }
    expect(h.refs.playSong.current).toHaveBeenCalledTimes(MAX_CONSECUTIVE_SONG_FAILURES - 1);
    expect(onGiveUp).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`连续 ${MAX_CONSECUTIVE_SONG_FAILURES} 首`));
    expect(h.refs.failedQueueSongKeys.current.size).toBe(0);
  });

  it('按 CORS、有限次刷新、降音质、推荐跳过、最终失败依次收尾', () => {
    const first = song('a', { recommendationRequestId: 'batch' });
    const h = harness(first); h.refs.queue.current.push(song('b', { recommendationRequestId: 'batch' }));
    const { result } = renderHook(() => usePlaybackRecovery(h.runtime, h.recommendation));
    const request = { song: first, quality: '320k' as const, trigger: 'mediaError' as const,
      canRetryWithoutCors: true, onGiveUp: vi.fn() };
    result.current.runRecovery(request);
    expect(h.refs.forceNoCorsPlayback.current).toBe(true);
    // 兼容模式已启用后，真实调用方不会再给出 canRetryWithoutCors
    const afterCors = { ...request, canRetryWithoutCors: false };
    for (let refresh = 1; refresh <= MAX_URL_REFRESHES; refresh += 1) {
      h.refs.activeParsedCacheKey.current = `netease:a:320k:${refresh}`;
      result.current.runRecovery(afterCors);
      expect(h.refs.playSong.current).toHaveBeenLastCalledWith(first, '320k');
      expect(h.refs.recoveryStage.current).toBe('initial');
    }
    h.refs.activeParsedCacheKey.current = 'netease:a:320k:9';
    result.current.runRecovery(afterCors);
    expect(h.refs.playSong.current).toHaveBeenLastCalledWith(first, '128k');
    // 降级只作用于这一首，不改写用户保存的音质偏好。
    expect(h.refs.audioQuality.current).toBe('320k');
    expect(h.runtime.setAudioQuality).not.toHaveBeenCalled();
    expect(h.recommendation.logPlaybackEvent).not.toHaveBeenCalled();
    result.current.runRecovery(afterCors);
    expect(h.refs.playSong.current).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }));
    expect(h.recommendation.showPlayerNotice).toHaveBeenLastCalledWith(expect.any(String), 'warning', 'songSkipped');
    expect(h.runtime.markSongUnplayable).toHaveBeenLastCalledWith(first, true);
    result.current.runRecovery(afterCors);
    expect(request.onGiveUp).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(h.runtime.markSongUnplayable).toHaveBeenCalledTimes(2);
    expect(h.refs.recoveryStage.current).toBe('initial');
  });

  it('无缓存且最低音质不可用、队列里也没有其它歌曲时直接结束', () => {
    const h = harness(); const onGiveUp = vi.fn();
    const { result } = renderHook(() => usePlaybackRecovery(h.runtime, h.recommendation));
    result.current.runRecovery({ song: song('a'), quality: '128k', trigger: 'playRejected', canRetryWithoutCors: false, onGiveUp });
    expect(onGiveUp).toHaveBeenCalledOnce();
    expect(h.refs.playSong.current).not.toHaveBeenCalled();
  });
});

describe('推荐播放事件与设置', () => {
  it('同一会话复用标识，仅记录有效的提前跳过', async () => {
    const h = harness(); const { result } = renderHook(() => useRecommendationPlayback(h.runtime));
    const session = result.current.startPlaybackSession();
    expect(result.current.startPlaybackSession()).toBe(session);
    act(() => result.current.showPlayerNotice('已准备好'));
    expect(h.runtime.setPlayerNotice).toHaveBeenCalledWith(expect.not.objectContaining({ kind: expect.anything() }));
    expect(h.runtime.setPlayerNotice).toHaveBeenCalledWith(expect.objectContaining({ message: '已准备好', tone: 'info' }));
    act(() => result.current.showPlayerNotice('无法播放', 'error', 'playbackFailed'));
    expect(h.runtime.setPlayerNotice).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'playbackFailed' }));
    h.audio.currentTime = 10;
    act(() => result.current.logEarlySkipIfNeeded());
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'skip_early', positionSeconds: 10, sessionId: session }));
    h.refs.play30LoggedKey.current = 'old'; h.refs.completeLoggedKey.current = 'old';
    expect(result.current.resetPlaybackState(song('a'))).toBe('netease:a');
    expect(h.refs.completeLoggedKey.current).toBeNull();
    logEvent.mockRejectedValueOnce(new Error('本地记录不可用'));
    await act(async () => result.current.logPlaybackEvent('play', song('b'), 2, 180, 'flac'));
    h.refs.currentSong.current = null;
    const calls = logEvent.mock.calls.length;
    result.current.logEarlySkipIfNeeded(); result.current.logPlaybackEvent('play', null);
    expect(logEvent).toHaveBeenCalledTimes(calls);
  });

  it('歌词偏移限制在有效范围，播放中切换音质重新解析', () => {
    const h = harness(); let offset = 0;
    h.runtime.setLyricOffsetSeconds = vi.fn((value) => { offset = typeof value === 'function' ? value(offset) : value; });
    const { result } = renderHook(() => usePlayerSettingsActions(h.runtime, h.recommendation));
    act(() => result.current.setLyricOffsetSeconds(100)); expect(offset).toBe(10);
    act(() => result.current.adjustLyricOffsetSeconds(-100)); expect(offset).toBe(-10);
    act(() => result.current.setLyricOffsetSeconds(Number.NaN)); expect(offset).toBe(0);
    act(() => result.current.adjustLyricOffsetSeconds(Number.NaN)); expect(offset).toBe(0);
    h.audio.paused = false; h.audio.currentTime = 5;
    act(() => result.current.setAudioQuality('flac'));
    expect(h.refs.audioQuality.current).toBe('flac');
    expect(h.refs.pendingQualityChange.current).toBe(true);
    expect(h.refs.playSong.current).toHaveBeenCalledWith(song('a'), 'flac');
    expect(h.recommendation.logPlaybackEvent).toHaveBeenCalledWith('quality_change', song('a'), 5, 180, 'flac');
  });
});
