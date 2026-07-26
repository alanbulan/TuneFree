import { useCallback, useEffect, useRef } from 'react';
import { usePlayerNowPlaying, usePlayerProgress } from '../../core/contexts/PlayerContext';
import { useTheme } from '../../core/contexts/ThemeContext';
import { useLyricDisplayMode } from '../../core/hooks/useLyricDisplayMode';
import {
  emitEventTo,
  isTauri,
  listenEvent,
  type LyricSongPayload,
  type LyricTickPayload,
} from '../../core/ipc';

const LYRIC_WINDOW = 'desktop-lyric';
const LYRIC_TICK_INTERVAL_MS = 500;
/** 进度跳变超过该秒数视为 seek，立即同步而不等心跳节流。 */
const SEEK_THRESHOLD_SECONDS = 1.5;

const buildTrackKey = (source?: string, id?: string | number): string =>
  source && id !== undefined ? `${source}:${id}` : '';

/**
 * Bridges playback state to the desktop lyric window.
 *
 * The full LRC text travels only when the track changes (`lyric-song`); the
 * 500ms heartbeat (`lyric-tick`) carries scalars alone. Both are addressed to
 * the lyric window rather than broadcast, since it is the only consumer.
 */
export default function LyricSyncBridge() {
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { currentTime, duration, lyricOffsetSeconds } = usePlayerProgress();
  const lyricDisplayMode = useLyricDisplayMode();
  const { showDesktopLyric } = useTheme();

  const trackKey = buildTrackKey(currentSong?.source, currentSong?.id);
  const lrc = currentSong?.lrc ?? null;

  const lastTickAtRef = useRef(0);
  const lastTickTimeRef = useRef(0);
  const lastSettingsRef = useRef('');

  const snapshotRef = useRef({
    trackKey,
    lrc,
    currentTime,
    duration,
    isPlaying,
    lyricOffsetSeconds,
    lyricDisplayMode,
    song: currentSong,
  });
  snapshotRef.current = {
    trackKey,
    lrc,
    currentTime,
    duration,
    isPlaying,
    lyricOffsetSeconds,
    lyricDisplayMode,
    song: currentSong,
  };

  const emitSong = useCallback(async () => {
    const snapshot = snapshotRef.current;
    const payload: LyricSongPayload = {
      trackKey: snapshot.trackKey,
      id: snapshot.song?.id ?? '',
      title: snapshot.song?.name ?? '',
      artist: snapshot.song?.artist ?? '',
      source: snapshot.song?.source ?? '',
      pic: snapshot.song?.pic,
      lrc: snapshot.lrc,
      duration: snapshot.duration,
    };
    try {
      await emitEventTo(LYRIC_WINDOW, 'lyric-song', payload);
    } catch (error) {
      console.error('同步歌词曲目信息失败:', error);
    }
  }, []);

  const emitTick = useCallback(async () => {
    const snapshot = snapshotRef.current;
    const payload: LyricTickPayload = {
      trackKey: snapshot.trackKey,
      currentTime: snapshot.currentTime,
      isPlaying: snapshot.isPlaying,
      sentAt: Date.now(),
      playbackRate: 1,
      lyricOffsetSeconds: snapshot.lyricOffsetSeconds,
      lyricDisplayMode: snapshot.lyricDisplayMode,
    };
    try {
      await emitEventTo(LYRIC_WINDOW, 'lyric-tick', payload);
    } catch (error) {
      console.error('同步歌词进度失败:', error);
    }
  }, []);

  // 曲目或歌词文本变化时下发一次全量，随后补一拍 tick 让歌词窗口立刻定位。
  useEffect(() => {
    if (!isTauri() || !showDesktopLyric) return;
    void emitSong().then(emitTick);
    lastTickAtRef.current = Date.now();
    lastTickTimeRef.current = snapshotRef.current.currentTime;
  }, [trackKey, lrc, showDesktopLyric, emitSong, emitTick]);

  // 进度心跳：节流到 500ms，但 seek、播放状态与歌词设置变化立即同步。
  useEffect(() => {
    if (!isTauri() || !showDesktopLyric) return;

    const settings = `${isPlaying ? 1 : 0}|${lyricOffsetSeconds}|${lyricDisplayMode}`;
    const settingsChanged = settings !== lastSettingsRef.current;
    const seeked = Math.abs(currentTime - lastTickTimeRef.current) > SEEK_THRESHOLD_SECONDS;
    const now = Date.now();
    const throttled = now - lastTickAtRef.current < LYRIC_TICK_INTERVAL_MS;

    if (!settingsChanged && !seeked && throttled) return;

    lastSettingsRef.current = settings;
    lastTickAtRef.current = now;
    lastTickTimeRef.current = currentTime;
    void emitTick();
  }, [currentTime, isPlaying, lyricOffsetSeconds, lyricDisplayMode, showDesktopLyric, emitTick]);

  // 歌词窗口挂载后主动索要一次全量，消除暂停时开窗错过首帧事件的空白。
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void listenEvent('desktop-lyric-ready', () => {
      void emitSong().then(emitTick);
    })
      .then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      })
      .catch((error) => console.error('监听歌词窗口就绪事件失败:', error));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [emitSong, emitTick]);

  return null;
}
