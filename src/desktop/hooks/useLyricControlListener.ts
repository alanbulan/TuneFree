import { useEffect, useRef } from 'react';
import { usePlayerActions } from '../../core/contexts/PlayerContext';
import { useTheme } from '../../core/contexts/ThemeContext';
import { useToast } from '../components/ToastHost';
import type { CloseBehavior } from '../../core/contexts/DesktopPreferencesContext';

interface UseLyricControlListenerOptions {
  lyricSize: number;
  lockDesktopLyric: boolean;
  closeBehavior: CloseBehavior;
  closePromptOpen: boolean;
}

/**
 * Encapsulates the four refs and the `player-control` / `desktop-lyric-closed`
 * event listeners that were previously inlined in `DesktopShell`.
 *
 * The refs are kept in sync with the latest prop values so that the
 * Tauri close-requested listener (still in DesktopShell) can read them
 * without stale closures.
 */
export function useLyricControlListener({
  lyricSize,
  lockDesktopLyric,
  closeBehavior,
  closePromptOpen,
}: UseLyricControlListenerOptions) {
  const { togglePlay, playNext, playPrev, seek } = usePlayerActions();
  const { setLockDesktopLyric, setLyricSize, setShowDesktopLyric } = useTheme();
  const { showToast } = useToast();

  const lyricSizeRef = useRef(lyricSize);
  const lockDesktopLyricRef = useRef(lockDesktopLyric);
  const closeBehaviorRef = useRef<CloseBehavior>(closeBehavior);
  const closePromptOpenRef = useRef(closePromptOpen);

  // Refs for action functions — updated every render so the Tauri event
  // listener (set up once) always calls the latest versions without needing
  // to re-register (which would create async gaps where events are lost).
  const actionsRef = useRef({
    togglePlay,
    playNext,
    playPrev,
    seek,
    setLockDesktopLyric,
    setLyricSize,
    setShowDesktopLyric,
    showToast,
  });
  actionsRef.current = {
    togglePlay,
    playNext,
    playPrev,
    seek,
    setLockDesktopLyric,
    setLyricSize,
    setShowDesktopLyric,
    showToast,
  };

  // Keep refs in sync with latest values.
  useEffect(() => {
    lyricSizeRef.current = lyricSize;
  }, [lyricSize]);

  useEffect(() => {
    lockDesktopLyricRef.current = lockDesktopLyric;
  }, [lockDesktopLyric]);

  useEffect(() => {
    closeBehaviorRef.current = closeBehavior;
  }, [closeBehavior]);

  useEffect(() => {
    closePromptOpenRef.current = closePromptOpen;
  }, [closePromptOpen]);

  // Listen for player-control and desktop-lyric-closed events.
  // Uses refs for all callbacks so the listener is registered exactly once
  // and never needs to be torn down / re-registered.
  useEffect(() => {
    const isTauri =
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;

    let controlUnlisten: (() => void) | null = null;
    let lyricCloseUnlisten: (() => void) | null = null;
    let cancelled = false;

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;

        controlUnlisten = await listen<{ action: string; value?: unknown }>(
          'player-control',
          (event) => {
            const { action, value } = event.payload;
            const actions = actionsRef.current;
            if (action === 'play-pause') {
              actions.togglePlay();
            } else if (action === 'next') {
              actions.playNext(true);
            } else if (action === 'prev') {
              actions.playPrev();
            } else if (action === 'seek') {
              actions.seek(Number(value));
            } else if (action === 'toggle-lock') {
              const nextLock = value !== undefined ? !!value : !lockDesktopLyricRef.current;
              actions.setLockDesktopLyric(nextLock);
              actions.showToast(
                nextLock ? '桌面歌词已锁定（鼠标穿透）' : '桌面歌词已解锁',
                'info',
              );
            } else if (action === 'adjust-lyric-size') {
              const nextSize = Math.max(14, Math.min(36, lyricSizeRef.current + Number(value)));
              actions.setLyricSize(nextSize);
            } else if (action === 'close-lyric') {
              actions.setShowDesktopLyric(false);
            }
          },
        );

        if (cancelled) {
          controlUnlisten?.();
          controlUnlisten = null;
          return;
        }

        lyricCloseUnlisten = await listen('desktop-lyric-closed', () => {
          actionsRef.current.setShowDesktopLyric(false);
        });
      } catch (e) {
        console.error('Failed to listen to player-control:', e);
      }
    };

    void setupListener();

    return () => {
      cancelled = true;
      controlUnlisten?.();
      lyricCloseUnlisten?.();
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps -- intentionally empty: listener registered once, reads latest via refs

  return {
    lyricSizeRef,
    lockDesktopLyricRef,
    closeBehaviorRef,
    closePromptOpenRef,
  };
}
