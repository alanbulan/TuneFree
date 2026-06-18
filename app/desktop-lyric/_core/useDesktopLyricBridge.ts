import { useEffect, useMemo, useState } from 'react';
import { findActiveLyricIndex, parseLyrics } from '../../../src/core/utils/lyrics';
import type { DesktopLyricCommand, DesktopLyricPlayerState, DesktopLyricSong, DesktopLyricStyleState, LyricUpdateEvent } from './types';
import { forceTransparentDocument, readAndApplyDesktopLyricTheme } from './theme';

export const useDesktopLyricBridge = () => {
  const [song, setSong] = useState<DesktopLyricSong | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTauri, setIsTauri] = useState(false);
  const [styleState, setStyleState] = useState<DesktopLyricStyleState>({ size: 22, font: 'system-ui', lock: false });

  useEffect(() => {
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
          const { song, currentTime, isPlaying, sentAt } = event.payload;
          const bridgeDelay = isPlaying && sentAt ? Math.min(0.25, Math.max(0, Date.now() - sentAt) / 1000) : 0;

          setSong(song);
          setCurrentTime(currentTime + bridgeDelay);
          setIsPlaying(isPlaying);
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
    const syncStyle = () => setStyleState(readAndApplyDesktopLyricTheme());

    window.addEventListener('storage', syncStyle);
    const interval = window.setInterval(syncStyle, 500);
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', syncStyle);

    return () => {
      window.removeEventListener('storage', syncStyle);
      window.clearInterval(interval);
      mediaQuery.removeEventListener('change', syncStyle);
    };
  }, []);

  const rawLyrics = song?.lrc || '';
  const rows = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const activeIndex = useMemo(() => findActiveLyricIndex(rows, currentTime), [rows, currentTime]);
  const currentLine = activeIndex >= 0 ? rows[activeIndex] : rows[0] ?? null;

  const playerState: DesktopLyricPlayerState = {
    song,
    rows,
    activeIndex,
    currentLine,
    currentTime,
    isPlaying,
  };

  const sendCommand = async (action: DesktopLyricCommand, value?: any) => {
    if (!isTauri) return;

    try {
      const { emitTo } = await import('@tauri-apps/api/event');
      await emitTo('main', 'player-control', { action, value });
    } catch (e) {
      console.error('Failed to emit player-control:', e);
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
