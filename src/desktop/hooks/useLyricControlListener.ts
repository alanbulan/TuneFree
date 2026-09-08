import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePlayerActions } from '../../core/contexts/PlayerContext';
import { useTheme } from '../../core/contexts/ThemeContext';
import { isTauri, listenEvent, type EventMap, type UnlistenFn } from '../../core/ipc';
import { useToast, type ToastTone } from '../components/ToastHost';
import type { CloseBehavior } from '../../core/contexts/DesktopPreferencesContext';

interface UseLyricControlListenerOptions {
  lyricSize: number;
  lockDesktopLyric: boolean;
  closeBehavior: CloseBehavior;
  closePromptOpen: boolean;
}

interface LyricControlActions {
  togglePlay: () => void;
  playNext: (force?: boolean) => void;
  playPrev: () => void;
  setLockDesktopLyric: (lock: boolean) => void;
  setLyricSize: (size: number) => void;
  setShowDesktopLyric: (show: boolean) => void;
  showToast: (message: string, tone?: ToastTone) => void;
}

const LYRIC_SIZE_MIN = 14;
const LYRIC_SIZE_MAX = 36;

/**
 * Applies one `player-control` payload. The lyric window only ever sends the
 * six `DesktopLyricCommand` actions, so unknown actions are ignored instead of
 * being mapped to speculative branches.
 */
const applyPlayerControl = (
  payload: EventMap['player-control'],
  actions: LyricControlActions,
  currentLyricSize: number,
  currentLock: boolean,
): void => {
  const { action, value } = payload;
  if (action === 'play-pause') {
    actions.togglePlay();
  } else if (action === 'next') {
    actions.playNext(true);
  } else if (action === 'prev') {
    actions.playPrev();
  } else if (action === 'toggle-lock') {
    const nextLock = value !== undefined ? !!value : !currentLock;
    actions.setLockDesktopLyric(nextLock);
    actions.showToast(
      nextLock ? '桌面歌词已锁定（鼠标穿透）' : '桌面歌词已解锁',
      'success',
    );
  } else if (action === 'adjust-lyric-size') {
    const nextSize = Math.max(
      LYRIC_SIZE_MIN,
      Math.min(LYRIC_SIZE_MAX, currentLyricSize + Number(value)),
    );
    actions.setLyricSize(nextSize);
  } else if (action === 'close-lyric') {
    actions.setShowDesktopLyric(false);
  }
};

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
  const { togglePlay, playNext, playPrev } = usePlayerActions();
  const { setLockDesktopLyric, setLyricSize, setShowDesktopLyric } = useTheme();
  const { showToast } = useToast();

  const lyricSizeRef = useRef(lyricSize);
  const lockDesktopLyricRef = useRef(lockDesktopLyric);
  const closeBehaviorRef = useRef<CloseBehavior>(closeBehavior);
  const closePromptOpenRef = useRef(closePromptOpen);

  // Refs for action functions — updated every render so the Tauri event
  // listener (set up once) always calls the latest versions without needing
  // to re-register (which would create async gaps where events are lost).
  const actionsRef = useRef<LyricControlActions>({
    togglePlay,
    playNext,
    playPrev,
    setLockDesktopLyric,
    setLyricSize,
    setShowDesktopLyric,
    showToast,
  });
  useLayoutEffect(() => {
    actionsRef.current = {
      togglePlay, playNext, playPrev, setLockDesktopLyric,
      setLyricSize, setShowDesktopLyric, showToast,
    };
  }, [togglePlay, playNext, playPrev, setLockDesktopLyric, setLyricSize, setShowDesktopLyric, showToast]);

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
    if (!isTauri()) return;

    let controlUnlisten: UnlistenFn | null = null;
    let lyricCloseUnlisten: UnlistenFn | null = null;
    let cancelled = false;

    const setupListener = async () => {
      try {
        controlUnlisten = await listenEvent('player-control', (payload) => {
          applyPlayerControl(
            payload,
            actionsRef.current,
            lyricSizeRef.current,
            lockDesktopLyricRef.current,
          );
        });

        if (cancelled) {
          controlUnlisten?.();
          controlUnlisten = null;
          return;
        }

        lyricCloseUnlisten = await listenEvent('desktop-lyric-closed', () => {
          actionsRef.current.setShowDesktopLyric(false);
        });

        if (cancelled) {
          lyricCloseUnlisten?.();
          lyricCloseUnlisten = null;
        }
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
