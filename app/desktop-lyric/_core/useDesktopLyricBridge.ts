import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { findActiveLyricIndex, parseLyrics } from '../../../src/core/utils/lyrics';
import type { DesktopLyricCommand, DesktopLyricPlayerState, DesktopLyricSong, DesktopLyricStyleState, LyricUpdateEvent } from './types';
import { forceTransparentDocument, readAndApplyDesktopLyricTheme } from './theme';

type PlaybackSnapshot = {
  song: DesktopLyricSong | null;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  lyricOffsetSeconds: number;
  receivedAt: number;
};

const getNowSeconds = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
};

export const useDesktopLyricBridge = () => {
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>({
    song: null,
    currentTime: 0,
    isPlaying: false,
    playbackRate: 1,
    lyricOffsetSeconds: 0,
    receivedAt: getNowSeconds(),
  });
  const [projectedTime, setProjectedTime] = useState(0);
  const [isTauri, setIsTauri] = useState(false);
  const [styleState, setStyleState] = useState<DesktopLyricStyleState>({ size: 22, font: 'system-ui', lock: false });

  useLayoutEffect(() => {
    const checkTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    setIsTauri(checkTauri);
    setStyleState(readAndApplyDesktopLyricTheme());
    forceTransparentDocument();
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    let lyricUnlisten: (() => void) | null = null;
    let lockUnlisten: (() => void) | null = null;

    const setupListeners = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        lyricUnlisten = await listen<LyricUpdateEvent>('lyric-update', (event) => {
          const { song, currentTime, isPlaying, playbackRate, lyricOffsetSeconds, sentAt } = event.payload;
          const now = getNowSeconds();
          const transportDelay = isPlaying && sentAt ? Math.max(0, Date.now() - sentAt) / 1000 : 0;
          const baseTime = currentTime + Math.min(0.25, transportDelay);

          setSnapshot({
            song,
            currentTime: baseTime,
            isPlaying,
            playbackRate: playbackRate && Number.isFinite(playbackRate) ? playbackRate : 1,
            lyricOffsetSeconds: Number.isFinite(lyricOffsetSeconds) ? lyricOffsetSeconds || 0 : 0,
            receivedAt: now,
          });
          setProjectedTime(baseTime);
        });

        lockUnlisten = await listen<boolean>('lock-change', (event) => {
          setStyleState((current) => ({ ...current, lock: event.payload }));
        });
      } catch (e) {
        console.error('Failed to setup desktop lyric bridge:', e);
      }
    };

    void setupListeners();

    return () => {
      lyricUnlisten?.();
      lockUnlisten?.();
    };
  }, [isTauri]);

  useEffect(() => {
    if (!snapshot.isPlaying) {
      setProjectedTime(snapshot.currentTime);
      return;
    }

    let frame = 0;
    const tick = () => {
      const elapsed = Math.max(0, getNowSeconds() - snapshot.receivedAt);
      setProjectedTime(snapshot.currentTime + elapsed * snapshot.playbackRate);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [snapshot]);

  useEffect(() => {
    let cancelled = false;
    const syncStyle = () => setStyleState(readAndApplyDesktopLyricTheme());

    window.addEventListener('storage', syncStyle);
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', syncStyle);

    let unlistenFn: (() => void) | null = null;
    const isTauriEnv = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    if (isTauriEnv) {
      import('@tauri-apps/api/event')
        .then(({ listen }) =>
          listen('theme-changed', () => {
            syncStyle();
          }),
        )
        .then((unlisten) => {
          if (cancelled) {
            unlisten();
          } else {
            unlistenFn = unlisten;
          }
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

  const rawLyrics = snapshot.song?.lrc || '';
  const rows = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const activeIndex = useMemo(
    () => findActiveLyricIndex(rows, projectedTime, snapshot.lyricOffsetSeconds),
    [rows, projectedTime, snapshot.lyricOffsetSeconds],
  );
  const currentLine = activeIndex >= 0 ? rows[activeIndex] : rows[0] ?? null;

  const playerState: DesktopLyricPlayerState = {
    song: snapshot.song,
    rows,
    activeIndex,
    currentLine,
    currentTime: projectedTime,
    isPlaying: snapshot.isPlaying,
  };

  const sendCommand = async (action: DesktopLyricCommand, value?: any) => {
    if (!isTauri) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('relay_player_control', { action, value });
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
