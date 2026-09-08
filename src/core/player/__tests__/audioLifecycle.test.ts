import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeDouble, song } from './playerTestDoubles';
import { createManagedAudioElement, detachAudioHandlers } from '../audioElement';
import { useAudioLifecycle } from '../useAudioLifecycle';
import type { RecommendationPlayback } from '../useRecommendationPlayback';
import type { PlaybackRecovery } from '../usePlaybackRecovery';

class TestAudio extends EventTarget {
  src = ''; paused = true; currentTime = 0; duration = 100; playbackRate = 1;
  preload = ''; crossOrigin: string | null = null; error: { code: number; message: string } | null = null;
  play = vi.fn().mockResolvedValue(undefined); pause = vi.fn(() => { this.paused = true; });
  load = vi.fn(); removeAttribute = vi.fn(() => { this.src = ''; });
}
const harness = () => {
  const h = createRuntimeDouble({ currentSong: song('1'), audio: null });
  const recommendation = { showPlayerNotice: vi.fn(), logPlaybackEvent: vi.fn() } as unknown as RecommendationPlayback;
  const recovery = { evictActiveParsedSong: vi.fn(), runRecovery: vi.fn() } as unknown as PlaybackRecovery;
  const sync = vi.fn(); const clear = vi.fn();
  const options = { runtime: h.runtime, recommendation, recovery, syncPlaybackTime: sync, clearActiveAudioSource: clear, withCors: true };
  return { ...h, recommendation, recovery, sync, clear, options };
};
const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
const step = () => { const scheduled = [...frames.values()]; frames.clear(); scheduled.forEach((callback) => callback(16)); };
const position = vi.fn();
beforeEach(() => {
  frames.clear(); frameId = 0; position.mockReset(); vi.stubGlobal('Audio', TestAudio);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: { setPositionState: position, metadata: null, playbackState: 'none' } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'mediaSession'); });

describe('原生音频元素事件', () => {
  it('播放进度上报一次有效播放和完成事件，同步元数据及等待状态', () => {
    const h = harness(); const audio = createManagedAudioElement(h.options) as unknown as TestAudio;
    expect(audio.preload).toBe('auto'); expect(audio.crossOrigin).toBe('anonymous');
    audio.currentTime = 31; audio.dispatchEvent(new Event('timeupdate')); audio.dispatchEvent(new Event('timeupdate'));
    expect(h.recommendation.logPlaybackEvent).toHaveBeenCalledTimes(1);
    expect(h.recommendation.logPlaybackEvent).toHaveBeenCalledWith('play_30s', song('1'), 31, 100);
    audio.currentTime = 80; audio.dispatchEvent(new Event('timeupdate')); audio.dispatchEvent(new Event('ended'));
    expect(h.recommendation.logPlaybackEvent).toHaveBeenCalledTimes(2); expect(h.sync).toHaveBeenCalledWith(true);
    expect(position).toHaveBeenLastCalledWith({ duration: 100, playbackRate: 1, position: 80 });
    h.refs.playNext.current = vi.fn(); h.refs.completeLoggedKey.current = null;
    audio.dispatchEvent(new Event('ended')); expect(h.refs.playNext.current).toHaveBeenCalledWith(false);
    audio.dispatchEvent(new Event('loadedmetadata')); audio.dispatchEvent(new Event('durationchange'));
    expect(h.setDuration).toHaveBeenCalledWith(100); expect(h.refs.recoveryStage.current).toBe('initial');
    audio.dispatchEvent(new Event('waiting')); expect(h.setIsLoading).toHaveBeenLastCalledWith(true);
    audio.dispatchEvent(new Event('canplay')); expect(h.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('旧音频解绑、音频上下文释放，缺少歌曲和无效时间不产生收听事件', async () => {
    const h = harness(); const first = createManagedAudioElement(h.options) as unknown as TestAudio;
    const close = vi.fn().mockRejectedValue(new Error('already closed'));
    h.refs.audioContext.current = { close } as unknown as AudioContext;
    const second = createManagedAudioElement({ ...h.options, withCors: false }) as unknown as TestAudio;
    expect(close).toHaveBeenCalledOnce(); expect(h.runtime.setAnalyser).toHaveBeenCalledWith(null);
    expect(first.pause).toHaveBeenCalledOnce(); expect(first.removeAttribute).toHaveBeenCalledWith('src');
    expect(second.crossOrigin).toBeNull(); first.dispatchEvent(new Event('timeupdate')); expect(h.sync).not.toHaveBeenCalled();
    h.refs.currentSong.current = null;
    for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'ended']) second.dispatchEvent(new Event(event));
    expect(h.recommendation.logPlaybackEvent).not.toHaveBeenCalled();
    h.refs.currentSong.current = song('1'); second.currentTime = NaN; second.duration = Infinity;
    second.dispatchEvent(new Event('timeupdate')); expect(h.recommendation.logPlaybackEvent).not.toHaveBeenCalled();
    second.duration = 100; position.mockImplementation(() => { throw new Error('not ready'); });
    expect(() => second.dispatchEvent(new Event('durationchange'))).not.toThrow();
    detachAudioHandlers(second as unknown as HTMLAudioElement, null); await Promise.resolve();
  });

  it('媒体错误交给统一恢复流程，无法恢复时清理音源并向用户报告', () => {
    const h = harness(); const audio = createManagedAudioElement(h.options) as unknown as TestAudio;
    audio.error = { code: 4, message: 'source not supported' }; audio.dispatchEvent(new Event('error'));
    const recover = vi.mocked(h.recovery.runRecovery).mock.calls[0][0]; expect(recover.canRetryWithoutCors).toBe(true);
    recover.onGiveUp(); expect(h.clear).toHaveBeenCalledOnce(); expect(h.setIsPlaying).toHaveBeenCalledWith(false);
    expect(h.recommendation.showPlayerNotice).toHaveBeenCalledWith('这首歌暂时无法播放，请换源或稍后再试', 'error');
    h.refs.currentSong.current = null; audio.error = { code: 2, message: 'network' }; audio.dispatchEvent(new Event('error'));
    expect(h.recovery.evictActiveParsedSong).toHaveBeenCalledOnce(); expect(h.refs.recoveryStage.current).toBe('initial');
    expect(h.clear).toHaveBeenCalledTimes(2);
  });
});

describe('播放器音频生命周期', () => {
  it('仅初始化一个元素，进度按阈值刷新，暂停停止帧，卸载释放音源与请求', () => {
    const h = harness(); h.runtime.isPlaying = true;
    const { result, rerender, unmount } = renderHook(() => useAudioLifecycle(h.runtime, h.recommendation, h.recovery));
    const audio = h.refs.audio.current as unknown as TestAudio;
    expect(frames.size).toBe(1); audio.currentTime = 0.05; act(step); expect(h.runtime.setCurrentTime).not.toHaveBeenCalled();
    audio.currentTime = 1.2; act(step); expect(h.runtime.setCurrentTime).toHaveBeenLastCalledWith(1.2);
    act(() => result.current.updateCurrentTimeState(NaN)); expect(h.runtime.setCurrentTime).toHaveBeenLastCalledWith(0);
    h.runtime.isPlaying = false; rerender(); expect(frames.size).toBe(0);
    act(() => result.current.clearActiveAudioSource()); expect(audio.load).toHaveBeenCalledOnce(); expect(h.setDuration).toHaveBeenLastCalledWith(0);
    h.refs.playAbort.current = new AbortController(); h.refs.preloadAbort.current = new AbortController();
    const playSignal = h.refs.playAbort.current.signal, preloadSignal = h.refs.preloadAbort.current.signal;
    h.refs.progressFrame.current = 7;
    const close = vi.fn().mockResolvedValue(undefined); h.refs.audioContext.current = { close } as unknown as AudioContext;
    unmount(); expect(playSignal.aborted).toBe(true); expect(preloadSignal.aborted).toBe(true); expect(close).toHaveBeenCalledOnce();
    expect(h.refs.progressFrame.current).toBeNull();
  });

  it('音频图只连接一次，恢复可见页面中的暂停上下文并发布媒体会话', async () => {
    const h = harness(); const analyser = { connect: vi.fn(), fftSize: 0, smoothingTimeConstant: 0 };
    const source = { connect: vi.fn() }; const resume = vi.fn().mockResolvedValue(undefined); const close = vi.fn().mockResolvedValue(undefined);
    class Context { destination = {}; state = 'suspended'; resume = resume; close = close; createAnalyser = () => analyser; createMediaElementSource = () => source; }
    vi.stubGlobal('AudioContext', Context); vi.stubGlobal('MediaMetadata', class { title = ''; constructor(data: object) { Object.assign(this, data); } });
    const { result, unmount } = renderHook(() => useAudioLifecycle(h.runtime, h.recommendation, h.recovery));
    act(() => { result.current.initAudioContext(); result.current.initAudioContext(); });
    expect(source.connect).toHaveBeenCalledOnce(); expect(analyser.fftSize).toBe(512); expect(h.refs.audioContextConnected.current).toBe(true);
    act(() => document.dispatchEvent(new Event('visibilitychange'))); await act(async () => {}); expect(resume).toHaveBeenCalledOnce();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {}); resume.mockRejectedValueOnce(new Error('blocked'));
    act(() => document.dispatchEvent(new Event('visibilitychange'))); await act(async () => {}); expect(warning).toHaveBeenCalled();
    act(() => result.current.updateMediaSession(song('1', { pic: 'https://img.test/a.jpg' }), 'playing'));
    expect(navigator.mediaSession.metadata?.artwork).toHaveLength(6); expect(navigator.mediaSession.playbackState).toBe('playing');
    act(() => result.current.updateMediaSession(song('2', { album: '' }), 'paused'));
    expect(navigator.mediaSession.metadata?.album).toBe('TuneFree Music');
    act(() => result.current.updatePositionState()); expect(position).toHaveBeenCalledWith({ duration: 100, playbackRate: 1, position: 0 });
    position.mockImplementation(() => { throw new Error('not ready'); }); expect(() => result.current.updatePositionState()).not.toThrow();
    unmount(); expect(close).toHaveBeenCalledOnce();
  });

  it('音频图建立失败释放已创建的上下文，不支持的环境仍可使用普通播放', async () => {
    const h = harness(); const close = vi.fn().mockRejectedValue(new Error('closed'));
    vi.stubGlobal('AudioContext', class { close = close; createAnalyser() { throw new Error('unsupported'); } });
    const { result } = renderHook(() => useAudioLifecycle(h.runtime, h.recommendation, h.recovery));
    act(() => result.current.initAudioContext()); await act(async () => {}); expect(close).toHaveBeenCalledOnce();
    expect(h.refs.audioContext.current).toBeNull();
    vi.stubGlobal('AudioContext', undefined); vi.stubGlobal('webkitAudioContext', undefined);
    act(() => result.current.initAudioContext()); h.refs.isIOS.current = true; act(() => result.current.initAudioContext());
    expect(h.runtime.setAnalyser).not.toHaveBeenCalled();
    h.refs.audio.current = null; act(() => { result.current.syncPlaybackTime(); result.current.updatePositionState(); result.current.clearActiveAudioSource(); });
    Reflect.deleteProperty(navigator, 'mediaSession'); act(() => { result.current.updateMediaSession(null, 'paused'); result.current.updatePositionState(); });
  });
});
