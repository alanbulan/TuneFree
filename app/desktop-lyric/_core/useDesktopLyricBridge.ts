import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { findActiveLyricIndex, parseLyrics, type ParsedLyric } from '../../../src/core/utils/lyrics';
import { normalizeLyricDisplayMode, type LyricDisplayMode } from '../../../src/core/utils/lyricDisplayMode';
import { readThemePreferences } from '../../../src/core/utils/theme';
import { invokeCommand, isTauri as detectTauri, listenEvent } from '../../../src/core/ipc';
import type { DesktopLyricCommand, DesktopLyricPlayerState, DesktopLyricSong, DesktopLyricStyleState } from './types';
import { readAndApplyDesktopLyricTheme } from './theme';

type TimingSnapshot = {
  trackKey: string;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  lyricOffsetSeconds: number;
  lyricDisplayMode: LyricDisplayMode;
  receivedAt: number;
};

export const getDesktopLyricCurrentLine = (
  rows: ParsedLyric[],
  activeIndex: number,
): ParsedLyric | null => activeIndex >= 0 ? rows[activeIndex] ?? null : rows[0] ?? null;

const getNowSeconds = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
};

const INITIAL_TIMING: TimingSnapshot = {
  trackKey: '',
  currentTime: 0,
  isPlaying: false,
  playbackRate: 1,
  lyricOffsetSeconds: 0,
  lyricDisplayMode: 'line',
  receivedAt: 0,
};

export const useDesktopLyricBridge = () => {
  const [song, setSong] = useState<DesktopLyricSong | null>(null);
  const [trackKey, setTrackKey] = useState('');
  const [timing, setTiming] = useState<TimingSnapshot>(() => ({
    ...INITIAL_TIMING,
    receivedAt: getNowSeconds(),
  }));
  const [projectedTime, setProjectedTime] = useState(0);
  const isTauri = detectTauri();
  const [styleState, setStyleState] = useState<DesktopLyricStyleState>(() => {
    const preferences = readThemePreferences(localStorage);
    return { size: preferences.lyricSize, font: preferences.lyricFont, lock: preferences.lockDesktopLyric };
  });

  useLayoutEffect(() => {
    readAndApplyDesktopLyricTheme();
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    const disposers: Array<() => void> = [];
    let cancelled = false;

    const register = (pending: Promise<() => void>) => {
      void pending
        .then((dispose) => {
          if (cancelled) dispose();
          else disposers.push(dispose);
        })
        .catch((error) => console.error('Failed to setup desktop lyric bridge:', error));
    };

    // 曲目信息（含完整 LRC）只在换歌时到达。
    register(
      listenEvent('lyric-song', (payload) => {
        setTrackKey(payload.trackKey);
        setSong(
          payload.trackKey
            ? {
                id: payload.id,
                name: payload.title,
                artist: payload.artist,
                source: payload.source,
                pic: payload.pic,
                lrc: payload.lrc ?? undefined,
              }
            : null,
        );
      }),
    );

    // 进度心跳只带标量；trackKey 不匹配说明是上一首的过期 tick，直接丢弃。
    register(
      listenEvent('lyric-tick', (payload) => {
        const transportDelay = payload.isPlaying && payload.sentAt
          ? Math.max(0, Date.now() - payload.sentAt) / 1000
          : 0;
        const baseTime = payload.currentTime + Math.min(0.25, transportDelay);
        setTiming({
          trackKey: payload.trackKey,
          currentTime: baseTime,
          isPlaying: payload.isPlaying,
          playbackRate: Number.isFinite(payload.playbackRate) && payload.playbackRate
            ? payload.playbackRate
            : 1,
          lyricOffsetSeconds: Number.isFinite(payload.lyricOffsetSeconds)
            ? payload.lyricOffsetSeconds || 0
            : 0,
          lyricDisplayMode: normalizeLyricDisplayMode(payload.lyricDisplayMode),
          receivedAt: getNowSeconds(),
        });
        setProjectedTime(baseTime);
      }),
    );

    register(
      listenEvent('lock-change', (locked) => {
        setStyleState((current) => ({ ...current, lock: locked }));
      }),
    );

    return () => {
      cancelled = true;
      disposers.forEach((dispose) => dispose());
    };
  }, [isTauri]);

  useEffect(() => {
    if (!timing.isPlaying) return;

    let frame = 0;
    const tick = () => {
      const elapsed = Math.max(0, getNowSeconds() - timing.receivedAt);
      setProjectedTime(timing.currentTime + elapsed * timing.playbackRate);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [timing]);

  useEffect(() => {
    let cancelled = false;
    const syncStyle = () => setStyleState(readAndApplyDesktopLyricTheme());

    window.addEventListener('storage', syncStyle);
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', syncStyle);

    let unlistenFn: (() => void) | null = null;
    if (detectTauri()) {
      void listenEvent('theme-changed', syncStyle)
        .then((unlisten) => {
          if (cancelled) unlisten();
          else unlistenFn = unlisten;
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      window.removeEventListener('storage', syncStyle);
      mediaQuery.removeEventListener('change', syncStyle);
      unlistenFn?.();
    };
  }, []);

  // tick 早于 lyric-song 到达时先不渲染上一首的歌词，避免串词。
  const rawLyrics = trackKey && timing.trackKey && trackKey !== timing.trackKey ? '' : song?.lrc || '';
  const rows = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const activeIndex = useMemo(
    () => findActiveLyricIndex(
      rows,
      projectedTime,
      timing.lyricOffsetSeconds,
      timing.lyricDisplayMode,
    ),
    [rows, projectedTime, timing.lyricOffsetSeconds, timing.lyricDisplayMode],
  );
  const currentLine = getDesktopLyricCurrentLine(rows, activeIndex);

  const playerState: DesktopLyricPlayerState = {
    song,
    rows,
    activeIndex,
    currentLine,
    currentTime: projectedTime,
    lyricOffsetSeconds: timing.lyricOffsetSeconds,
    lyricDisplayMode: timing.lyricDisplayMode,
    isPlaying: timing.isPlaying,
  };

  const sendCommand = async (action: DesktopLyricCommand, value?: unknown) => {
    if (!isTauri) return;

    try {
      await invokeCommand('relay_player_control', { action, value });
    } catch (e) {
      console.error('Failed to send player-control:', e);
    }
  };

  const adjustLyricSize = (delta: number) => {
    setStyleState((current) => ({
      ...current,
      size: Math.max(14, Math.min(36, current.size + delta)),
    }));
    void sendCommand('adjust-lyric-size', delta);
  };

  const lock = () => {
    setStyleState((current) => ({ ...current, lock: true }));
    void sendCommand('toggle-lock', true);
  };

  return {
    isTauri,
    playerState,
    styleState,
    controls: {
      playPause: () => void sendCommand('play-pause'),
      prev: () => void sendCommand('prev'),
      next: () => void sendCommand('next'),
      lock,
      close: () => void sendCommand('close-lyric'),
      adjustLyricSize,
    },
  };
};
