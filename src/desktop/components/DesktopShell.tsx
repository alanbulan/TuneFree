import { FormEvent, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { useDesktopPreferences } from '../../core/contexts/DesktopPreferencesContext';
import { usePlayerNotice, usePlayerNowPlaying, usePlayerProgress } from '../../core/contexts/PlayerContext';
import { useTheme } from '../../core/contexts/ThemeContext';
import { useLyricDisplayMode } from '../../core/hooks/useLyricDisplayMode';
import DesktopHome from '../features/home/DesktopHome';
import type { DesktopView, LibraryView } from '../types';
import DesktopFullPlayer from './DesktopFullPlayer';
import DesktopTransport from './DesktopTransport';
import MiraPet from './MiraPet';
import { useToast } from './ToastHost';
import { useLyricControlListener } from '../hooks/useLyricControlListener';
import ClosePrompt from './ClosePrompt';
import { DesktopSidebar, WindowBar } from './DesktopShellChrome';

// P3-16: Lazy-load non-first-screen views for code splitting
const LoadingSpinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
    <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>加载中…</span>
  </div>
);
const DesktopLibrary = lazy(() => import('../features/library/DesktopLibrary'));
const DesktopSearch = lazy(() => import('../features/search/DesktopSearch'));

interface DesktopShellProps {
  view: DesktopView;
  onViewChange: (view: DesktopView) => void;
}

const libraryViews: LibraryView[] = ['favorites', 'playlists', 'downloads', 'settings', 'about'];

const isTauri = typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

const LYRIC_SYNC_INTERVAL_MS = 500;

function LyricSyncBridge() {
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { currentTime, duration, lyricOffsetSeconds } = usePlayerProgress();
  const lyricDisplayMode = useLyricDisplayMode();
  const { showDesktopLyric } = useTheme();
  const lastSyncAtRef = useRef(0);
  const lastSignatureRef = useRef('');
  const lastSyncedTimeRef = useRef(0);

  useEffect(() => {
    if (!isTauri || !showDesktopLyric) return;

    const signature = [
      currentSong?.source ?? '',
      currentSong?.id ?? '',
      currentSong?.lrc ?? '',
      isPlaying ? '1' : '0',
      duration,
      lyricOffsetSeconds,
      lyricDisplayMode,
    ].join('');
    const now = Date.now();
    const stateChanged = signature !== lastSignatureRef.current;
    const seeked = Math.abs(currentTime - lastSyncedTimeRef.current) > 1.5;
    const throttled = now - lastSyncAtRef.current < LYRIC_SYNC_INTERVAL_MS;

    if (!stateChanged && !seeked && throttled) return;

    lastSignatureRef.current = signature;
    lastSyncedTimeRef.current = currentTime;
    lastSyncAtRef.current = now;

    const syncLyric = async () => {
      try {
        const { emit } = await import('@tauri-apps/api/event');
        await emit('lyric-update', {
          song: currentSong ? {
            id: currentSong.id,
            name: currentSong.name,
            artist: currentSong.artist,
            source: currentSong.source,
            pic: currentSong.pic,
            lrc: currentSong.lrc,
          } : null,
          currentTime,
          duration,
          isPlaying,
          playbackRate: 1,
          lyricOffsetSeconds,
          lyricDisplayMode,
          sentAt: now,
        });
      } catch (e) {
        console.error('Failed to emit lyric-update:', e);
      }
    };

    void syncLyric();
  }, [currentSong, isPlaying, currentTime, duration, lyricOffsetSeconds, lyricDisplayMode, showDesktopLyric]);

  return null;
}

export default function DesktopShell({ view, onViewChange }: DesktopShellProps) {
  const { closeBehavior, setCloseBehavior } = useDesktopPreferences();
  const { playerNotice } = usePlayerNotice();
  const { showToast } = useToast();
  const { lockDesktopLyric, lyricSize } = useTheme();
  const [commandQuery, setCommandQuery] = useState('');
  const [searchRequest, setSearchRequest] = useState({ query: '', nonce: 0 });
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [rememberCloseChoice, setRememberCloseChoice] = useState(false);

  // P2-6: Refs and player-control listeners extracted to hook.
  const { closeBehaviorRef, closePromptOpenRef } = useLyricControlListener({
    lyricSize,
    lockDesktopLyric,
    closeBehavior,
    closePromptOpen,
  });

  useEffect(() => {
    if (playerNotice) showToast(playerNotice.message, playerNotice.tone);
  }, [playerNotice, showToast]);

  const hideMainToTray = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().hide();
      showToast('TuneFree 已在后台继续运行，可从系统托盘恢复', 'info');
    } catch (e) {
      console.error('Failed to hide main window to tray:', e);
      showToast('最小化到托盘失败', 'error');
    }
  }, [showToast]);

  const quitApplication = useCallback(async () => {
    if (!isTauri) return;
    try {
      await invoke('quit_app');
    } catch (e) {
      console.error('Failed to quit app:', e);
      showToast('退出应用失败', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | null = null;

    const setupCloseListener = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        unlisten = await getCurrentWindow().onCloseRequested((event) => {
          event.preventDefault();
          const behavior = closeBehaviorRef.current;

          if (behavior === 'tray') {
            void hideMainToTray();
            return;
          }

          if (behavior === 'exit') {
            void quitApplication();
            return;
          }

          if (!closePromptOpenRef.current) {
            setRememberCloseChoice(false);
            setClosePromptOpen(true);
          }
        });
      } catch (e) {
        console.error('Failed to listen to close requested:', e);
      }
    };

    void setupCloseListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [hideMainToTray, quitApplication, closeBehaviorRef, closePromptOpenRef]);

  const resolveClosePrompt = (action: 'tray' | 'exit' | 'cancel') => {
    if (action === 'cancel') {
      setClosePromptOpen(false);
      return;
    }

    if (rememberCloseChoice) {
      setCloseBehavior(action);
    }

    setClosePromptOpen(false);
    if (action === 'tray') {
      void hideMainToTray();
    } else {
      void quitApplication();
    }
  };

  const submitSearch = (query: string) => {
    const clean = query.trim();
    if (!clean) return;
    localStorage.setItem('tunefree_desktop_pending_query', clean);
    setSearchRequest((prev) => ({ query: clean, nonce: prev.nonce + 1 }));
    onViewChange('search');
  };

  const handleCommandSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitSearch(commandQuery);
  };

  return (
    <div className={`desktop-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <WindowBar view={view} commandQuery={commandQuery}
        onCommandQueryChange={setCommandQuery} onCommandSearch={handleCommandSearch} />
      <DesktopSidebar view={view} collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((previous) => !previous)} onViewChange={onViewChange} />

      <main className="workspace">
        <div className="view-scroll" key={view}>
          <div className="view-transition-panel">
            {view === 'home' && <DesktopHome onViewChange={onViewChange} />}
            <Suspense fallback={<LoadingSpinner />}>
              {view === 'search' && <DesktopSearch commandQuery={searchRequest.query} commandNonce={searchRequest.nonce} />}
              {libraryViews.includes(view as LibraryView) && <DesktopLibrary activeView={view as LibraryView} />}
            </Suspense>
          </div>
        </div>
      </main>

      <MiraPet />
      <LyricSyncBridge />
      <DesktopTransport onExpand={() => setFullPlayerOpen(true)} />
      <AnimatePresence>
        {fullPlayerOpen && (
          <DesktopFullPlayer isOpen={fullPlayerOpen} onClose={() => setFullPlayerOpen(false)} onSearch={submitSearch} />
        )}
      </AnimatePresence>

      <ClosePrompt open={closePromptOpen} rememberChoice={rememberCloseChoice}
        onRememberChoiceChange={setRememberCloseChoice} onResolve={resolveClosePrompt} />
    </div>
  );
}
