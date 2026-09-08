import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider, usePlayerActions, usePlayerAnalyser, usePlayerNotice, usePlayerNowPlaying,
  usePlayerProgress, usePlayerQueueState, usePlayerSettings } from '../PlayerContext';
import { useLibrary } from '../LibraryContext';
import { useDesktopPreferences } from '../DesktopPreferencesContext';
import { useTheme } from '../ThemeContext';
import { createPlaybackSessionId, evictParsedCacheForSong, isUnsupportedSourcePlayError, shouldFetchBetterLyrics, shouldUseLyricCandidate } from '../../player/playerUtils';
import type { ParsedSongCacheEntry } from '../../player/types';
import { mergeLyricTracks } from '../../utils/lyrics';

vi.mock('../../services/api', () => ({ parseSongFull: vi.fn().mockResolvedValue({ url: 'https://audio.test/song.mp3', lrc: '[00:01]歌词', pic: '' }), getLyrics: vi.fn().mockResolvedValue('[00:01]歌词') }));
vi.mock('../../services/offlineDownloads', () => ({ resolveOfflinePlayback: vi.fn().mockResolvedValue(null) }));
vi.mock('../../services/recommendation', () => ({ logRecommendationEvent: vi.fn().mockResolvedValue(undefined) }));
const instances: TestAudio[] = [];
class TestAudio extends EventTarget {
  src = ''; paused = true; currentTime = 0; duration = 100; playbackRate = 1; preload = ''; crossOrigin: string | null = null;
  play = vi.fn(async () => { this.paused = false; }); pause = vi.fn(() => { this.paused = true; });
  load = vi.fn(); removeAttribute = vi.fn(() => { this.src = ''; });
  constructor() { super(); instances.push(this); }
}
beforeEach(() => { localStorage.clear(); instances.length = 0; vi.stubGlobal('Audio', TestAudio); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('播放器 Provider 完整链路', () => {
  it('音频、解析、队列与上下文联动，普通进度刷新不改变低频状态引用', async () => {
    const view = renderHook(() => ({ actions: usePlayerActions(), now: usePlayerNowPlaying(), progress: usePlayerProgress(),
      queue: usePlayerQueueState(), settings: usePlayerSettings(), analyser: usePlayerAnalyser(), notice: usePlayerNotice() }), { wrapper: PlayerProvider });
    expect(view.result.current.now.currentSong).toBeNull();
    await act(() => view.result.current.actions.playSong({ id: '1', source: 'qq', name: '歌', artist: '歌手', album: '' }));
    expect(view.result.current.now.isPlaying).toBe(true); expect(view.result.current.queue.queue).toHaveLength(1);
    const audio = instances[instances.length - 1]; act(() => audio.dispatchEvent(new Event('loadedmetadata')));
    const now = view.result.current.now; act(() => view.result.current.actions.seek(50)); expect(view.result.current.progress.currentTime).toBe(50); expect(view.result.current.now).toBe(now);
    act(() => view.result.current.actions.seek(94)); expect(view.result.current.now.isNearEnd).toBe(true);
    act(() => view.result.current.actions.pausePlayback()); expect(view.result.current.now.isPlaying).toBe(false);
    await act(() => view.result.current.actions.playSong(view.result.current.now.currentSong!)); expect(view.result.current.now.isPlaying).toBe(true);
    act(() => view.result.current.actions.setLyricOffsetSeconds(0.5)); expect(view.result.current.progress.lyricOffsetSeconds).toBe(0.5);
    expect(view.result.current.analyser.analyser).toBeNull(); expect(view.result.current.notice.playerNotice).toBeNull();
    view.unmount(); expect(audio.pause).toHaveBeenCalled();
  });
  it('缺少各自 Provider 时直接报告错误', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const hook of [usePlayerActions, usePlayerNowPlaying, usePlayerProgress, usePlayerQueueState, usePlayerSettings, usePlayerAnalyser, usePlayerNotice, useLibrary, useDesktopPreferences, useTheme]) {
      expect(() => renderHook(hook as () => unknown)).toThrow(/Provider/);
    }
  });
  it('缓存清理仅影响目标歌曲，歌词候选只采用更完整的版本', () => {
    const cache = new Map<string, ParsedSongCacheEntry>(['qq:1:flac', 'qq:1:320k', 'qq:2:320k'].map((key) => [key, { parsed: { url: key, lrc: '', pic: '' }, cachedAt: 1 } as unknown as ParsedSongCacheEntry]));
    evictParsedCacheForSong(cache, { id: '1', source: 'qq' }); expect([...cache.keys()]).toEqual(['qq:2:320k']);
    vi.stubGlobal('crypto', undefined); expect(createPlaybackSessionId()).toMatch(/^playback:\d+-/);
    expect(isUnsupportedSourcePlayError('string error')).toBe(false); expect(isUnsupportedSourcePlayError(new Error('source unavailable'))).toBe(true);
    const line = '[00:01]你好', karaoke = '[1000,1000](1000,500,0)你(1500,500,0)好';
    expect(shouldUseLyricCandidate(line, karaoke)).toBe(true);
    expect(shouldUseLyricCandidate(line, mergeLyricTracks({ main: line, translation: '[00:01]hello', source: 'qq' }))).toBe(true);
    expect(shouldFetchBetterLyrics({ source: 'qq' }, line)).toBe(true); expect(shouldFetchBetterLyrics({ source: 'unknown' }, line)).toBe(false);
  });
});
