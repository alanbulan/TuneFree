import { FormEvent, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useDesktopPreferences } from '../../core/contexts/DesktopPreferencesContext';
import { usePlayerNotice } from '../../core/contexts/PlayerContext';
import { useTheme } from '../../core/contexts/ThemeContext';
import { getCurrentWindow, invokeCommand, isTauri } from '../../core/ipc';
import DesktopHome from '../features/home/DesktopHome';
import type { DesktopView, LibraryView } from '../types';
import DesktopFullPlayer from './DesktopFullPlayer';
import DesktopTransport from './DesktopTransport';
import LyricSyncBridge from './LyricSyncBridge';
import BloubCompanion from './MiraPet';
import { useToast } from './ToastHost';
import { useLyricControlListener } from '../hooks/useLyricControlListener';
import ClosePrompt from './ClosePrompt';
import { DesktopSidebar, WindowBar } from './DesktopShellChrome';
import MotionPanel from './MotionPanel';

// P3-16: Lazy-load non-first-screen views for code splitting
const LoadingSpinner = () => (
  <div className="view-loading">
    <span className="view-loading-label">加载中…</span>
  </div>
);
const DesktopLibrary = lazy(() => import('../features/library/DesktopLibrary'));
const DesktopSearch = lazy(() => import('../features/search/DesktopSearch'));

interface DesktopShellProps {
  view: DesktopView;
  onViewChange: (view: DesktopView) => void;
}

const libraryViews: LibraryView[] = ['favorites', 'playlists', 'downloads', 'settings', 'about'];

/**
 * Remembers each view's scroll offset on the shared scroll container.
 *
 * The container used to be keyed by view, which remounted it on every
 * navigation and discarded the offset along with it.
 */
function useViewScrollMemory(view: DesktopView) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const offsetsRef = useRef<Partial<Record<DesktopView, number>>>({});
  const activeViewRef = useRef<DesktopView>(view);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (container) offsetsRef.current[activeViewRef.current] = container.scrollTop;
  }, []);

  useLayoutEffect(() => {
    activeViewRef.current = view;
    const container = containerRef.current;
    if (container) container.scrollTop = offsetsRef.current[view] ?? 0;
  }, [view]);

  return { containerRef, handleScroll };
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
  const [aiBusy, setAiBusy] = useState(false);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [rememberCloseChoice, setRememberCloseChoice] = useState(false);
  const { containerRef, handleScroll } = useViewScrollMemory(view);

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
    if (!isTauri()) return;
    try {
      await getCurrentWindow().hide();
      showToast('TuneFree 已在后台继续运行，可从系统托盘恢复', 'info');
    } catch (e) {
      console.error('Failed to hide main window to tray:', e);
      showToast('最小化到托盘失败', 'error');
    }
  }, [showToast]);

  const quitApplication = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invokeCommand('quit_app');
    } catch (e) {
      console.error('Failed to quit app:', e);
      showToast('退出应用失败', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | null = null;
    let disposed = false;

    const setupCloseListener = async () => {
      try {
        unlisten = await getCurrentWindow().onCloseRequested((event) => {
          if (disposed) return;
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
        if (disposed) { unlisten(); unlisten = null; }
      } catch (e) {
        console.error('Failed to listen to close requested:', e);
      }
    };

    void setupCloseListener();

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [hideMainToTray, quitApplication, closeBehaviorRef, closePromptOpenRef]);

  const resolveClosePrompt = useCallback((action: 'tray' | 'exit' | 'cancel') => {
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
  }, [hideMainToTray, quitApplication, rememberCloseChoice, setCloseBehavior]);

  // memo 过的子树（FullPlayerActions / TransportMiniLyric）拿到的必须是稳定引用，
  // 而 onViewChange 由外层每次渲染重新创建，这里用 ref 兜住它。
  const viewChangeRef = useRef(onViewChange);
  useEffect(() => {
    viewChangeRef.current = onViewChange;
  });

  const submitSearch = useCallback((query: string) => {
    const clean = query.trim();
    if (!clean) return;
    localStorage.setItem('tunefree_desktop_pending_query', clean);
    setSearchRequest((prev) => ({ query: clean, nonce: prev.nonce + 1 }));
    viewChangeRef.current('search');
  }, []);

  const openFullPlayer = useCallback(() => setFullPlayerOpen(true), []);
  const closeFullPlayer = useCallback(() => setFullPlayerOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((previous) => !previous), []);

  const handleCommandSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitSearch(commandQuery);
  };

  return (
    <div className={`desktop-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <WindowBar view={view} commandQuery={commandQuery}
        onCommandQueryChange={setCommandQuery} onCommandSearch={handleCommandSearch} />
      <DesktopSidebar view={view} collapsed={sidebarCollapsed}
        onToggle={toggleSidebar} onViewChange={onViewChange} />

      <main className="workspace">
        <div className="view-scroll" ref={containerRef} onScroll={handleScroll}>
          <MotionPanel className="view-transition-panel" transitionKey={view}>
            {view === 'home' && <DesktopHome onViewChange={onViewChange} onAiBusyChange={setAiBusy} />}
            <Suspense fallback={<LoadingSpinner />}>
              {view === 'search' && <DesktopSearch commandQuery={searchRequest.query} commandNonce={searchRequest.nonce} />}
              {libraryViews.includes(view as LibraryView) && <DesktopLibrary activeView={view as LibraryView} />}
            </Suspense>
          </MotionPanel>
        </div>
      </main>

      {!fullPlayerOpen && <BloubCompanion aiBusy={aiBusy} />}
      <LyricSyncBridge />
      <DesktopTransport onExpand={openFullPlayer} suspended={fullPlayerOpen} />
      <AnimatePresence>
        {fullPlayerOpen && (
          <DesktopFullPlayer isOpen={fullPlayerOpen} onClose={closeFullPlayer} onSearch={submitSearch} />
        )}
      </AnimatePresence>

      <ClosePrompt open={closePromptOpen} rememberChoice={rememberCloseChoice}
        onRememberChoiceChange={setRememberCloseChoice} onResolve={resolveClosePrompt} />
    </div>
  );
}
