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
  useEffect(() => {
    const isTauri =
      typeof window !== 'undefined' &&
      '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;

    let controlUnlisten: (() => void) | null = null;
    let lyricCloseUnlisten: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        controlUnlisten = await listen<{ action: string; value?: unknown }>(
          'player-control',
          (event) => {
            const { action, value } = event.payload;
            if (action === 'play-pause') {
              togglePlay();
            } else if (action === 'next') {
              playNext(true);
            } else if (action === 'prev') {
              playPrev();
            } else if (action === 'seek') {
              seek(Number(value));
            } else if (action === 'toggle-lock') {
              const nextLock = value !== undefined ? !!value : !lockDesktopLyricRef.current;
              setLockDesktopLyric(nextLock);
              showToast(
                nextLock ? '桌面歌词已锁定（鼠标穿透）' : '桌面歌词已解锁',
                'info',
              );
            } else if (action === 'adjust-lyric-size') {
              const nextSize = Math.max(14, Math.min(36, lyricSizeRef.current + Number(value)));
              setLyricSize(nextSize);
            } else if (action === 'close-lyric') {
              setShowDesktopLyric(false);
            }
          },
        );

        lyricCloseUnlisten = await listen('desktop-lyric-closed', () => {
          setShowDesktopLyric(false);
        });
      } catch (e) {
        console.error('Failed to listen to player-control:', e);
      }
    };

    void setupListener();

    return () => {
      controlUnlisten?.();
      lyricCloseUnlisten?.();
    };
  }, [
    togglePlay,
    playNext,
    playPrev,
    seek,
    setLockDesktopLyric,
    setLyricSize,
    setShowDesktopLyric,
    showToast,
  ]);

  return {
    lyricSizeRef,
    lockDesktopLyricRef,
    closeBehaviorRef,
    closePromptOpenRef,
  };
}
