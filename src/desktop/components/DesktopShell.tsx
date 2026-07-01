import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { DownloadIcon, HeartIcon, HomeIcon, InfoIcon, LibraryIcon, SearchIcon, SettingsIcon, SidebarCollapseIcon, SidebarExpandIcon } from '../../core/components/Icons';
import { Sun, Moon, Laptop } from 'lucide-react';
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

// P3-16: Lazy-load non-first-screen views for code splitting
const LoadingSpinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
    <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>加载中…</span>
  </div>
);
const DesktopLibrary = dynamic(() => import('../features/library/DesktopLibrary'), { loading: () => <LoadingSpinner /> });
const DesktopSearch = dynamic(() => import('../features/search/DesktopSearch'), { loading: () => <LoadingSpinner /> });

interface DesktopShellProps {
  view: DesktopView;
  onViewChange: (view: DesktopView) => void;
}

const navItems: { view: DesktopView; label: string; icon: React.ReactNode }[] = [
  { view: 'home', label: '首页', icon: <HomeIcon size={17} /> },
  { view: 'search', label: '搜索', icon: <SearchIcon size={17} /> },
  { view: 'favorites', label: '收藏', icon: <HeartIcon size={17} /> },
  { view: 'playlists', label: '歌单', icon: <LibraryIcon size={17} /> },
  { view: 'downloads', label: '下载', icon: <DownloadIcon size={17} /> },
  { view: 'settings', label: '管理', icon: <SettingsIcon size={17} /> },
  { view: 'about', label: '关于', icon: <InfoIcon size={17} /> },
];

const libraryViews: LibraryView[] = ['favorites', 'playlists', 'downloads', 'settings', 'about'];

const isTauri = typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

const handleWindowControl = async (action: 'minimize' | 'maximize' | 'close') => {
  if (isTauri) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      if (action === 'minimize') {
        await appWindow.minimize();
      } else if (action === 'maximize') {
        await appWindow.toggleMaximize();
      } else if (action === 'close') {
        await appWindow.close();
      }
    } catch (e) {
      console.error('Failed to control window:', e);
    }
  }
};

export default function DesktopShell({ view, onViewChange }: DesktopShellProps) {
  const { closeBehavior, setCloseBehavior } = useDesktopPreferences();
  const { playerNotice } = usePlayerNotice();
  const { showToast } = useToast();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { currentTime, duration, lyricOffsetSeconds } = usePlayerProgress();
  const lyricDisplayMode = useLyricDisplayMode();
  const {
    showDesktopLyric,
    lockDesktopLyric,
    lyricSize,
    themeMode,
    setThemeMode,
  } = useTheme();
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

  // P3-9: Focus trap for close prompt
  const closePromptCancelRef = useRef<HTMLButtonElement>(null);
  const closePromptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (playerNotice) showToast(playerNotice.message, playerNotice.tone);
  }, [playerNotice, showToast]);

  // P3-9: Auto-focus cancel button when prompt opens
  useEffect(() => {
    if (!closePromptOpen) return;
    const timer = setTimeout(() => {
      closePromptCancelRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [closePromptOpen]);

  // P3-9: Focus trap - Tab key cycling within the prompt
  useEffect(() => {
    if (!closePromptOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const container = closePromptRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closePromptOpen]);

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

  // Cross-window lyric sync
  useEffect(() => {
    if (!isTauri || !showDesktopLyric) return;

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
          sentAt: Date.now(),
        });
      } catch (e) {
        console.error('Failed to emit lyric-update:', e);
      }
    };

    syncLyric();
  }, [currentSong, isPlaying, currentTime, duration, lyricOffsetSeconds, lyricDisplayMode, showDesktopLyric]);

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

  const themeLabel = themeMode === 'light' ? '浅色' : themeMode === 'dark' ? '深色' : '随系统';
  const nextThemeMode = themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'light' ? '浅色' : nextThemeMode === 'dark' ? '深色' : '随系统';

  return (
    <div className={`desktop-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="window-bar" data-tauri-drag-region style={{ height: '100%' }}>
        <div className="window-brand-zone" data-tauri-drag-region>
          <div className="window-brand-lockup" aria-label="TuneFree Desktop" data-tauri-drag-region>
            <img className="brand-mark" src="/icon.svg" alt="" aria-hidden="true" data-tauri-drag-region />
            <span data-tauri-drag-region>TuneFree</span>
          </div>
          <button
            type="button"
            className="theme-toggle-btn brand-theme-toggle"
            title={`当前主题：${themeLabel}\n点击切换到${nextThemeLabel}`}
            aria-label={`当前主题：${themeLabel}，点击切换到${nextThemeLabel}`}
            onClick={() => setThemeMode(nextThemeMode)}
          >
            {themeMode === 'light' && <Sun size={14} />}
            {themeMode === 'dark' && <Moon size={14} />}
            {themeMode === 'system' && <Laptop size={14} />}
          </button>
        </div>
        <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', flex: 1, height: '100%', minWidth: 0 }}>
          {view !== 'search' && (
            <form className="command-search" onSubmit={handleCommandSearch}>
              <SearchIcon size={15} />
              <input aria-label="搜索音乐" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="搜索" />
            </form>
          )}
          <div data-tauri-drag-region style={{ flex: 1, height: '100%' }} />
        </div>
        {isTauri ? (
          <div className="window-controls">
            {/* P3-14: Chinese aria-labels */}
            <button className="win-btn minimize" onClick={() => handleWindowControl('minimize')} data-tooltip="最小化" aria-label="最小化" />
            <button className="win-btn maximize" onClick={() => handleWindowControl('maximize')} data-tooltip="最大化" aria-label="最大化" />
            <button className="win-btn close" onClick={() => handleWindowControl('close')} data-tooltip="关闭" aria-label="关闭" />
          </div>
        ) : <div />}
      </header>

      <aside className="sidebar">
        <div className="sidebar-topline">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarCollapsed ? '展开侧边菜单' : '收起侧边菜单'}
            title={sidebarCollapsed ? '展开侧边菜单' : '收起侧边菜单'}
            onClick={() => setSidebarCollapsed((prev) => !prev)}
          >
            {sidebarCollapsed ? <SidebarExpandIcon size={16} /> : <SidebarCollapseIcon size={16} />}
          </button>
        </div>
        <p className="sidebar-section-title">TuneFree</p>
        <nav className="nav-group" aria-label="主导航">
          {navItems.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`nav-button ${view === item.view ? 'active' : ''}`}
              aria-current={view === item.view ? 'page' : undefined}
              title={item.label}
              onClick={() => onViewChange(item.view)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <div className="view-scroll" key={view}>
          <div className="view-transition-panel">
            {view === 'home' && <DesktopHome onViewChange={onViewChange} />}
            {view === 'search' && <DesktopSearch commandQuery={searchRequest.query} commandNonce={searchRequest.nonce} />}
            {libraryViews.includes(view as LibraryView) && <DesktopLibrary activeView={view as LibraryView} />}
          </div>
        </div>
      </main>

      <MiraPet />
      <DesktopTransport onExpand={() => setFullPlayerOpen(true)} />
      <AnimatePresence>
        {fullPlayerOpen && (
          <DesktopFullPlayer isOpen={fullPlayerOpen} onClose={() => setFullPlayerOpen(false)} onSearch={submitSearch} />
        )}
      </AnimatePresence>

      {/* P3-9: Close prompt with AnimatePresence and focus trap */}
      <AnimatePresence>
        {closePromptOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="presentation"
            onMouseDown={() => resolveClosePrompt('cancel')}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              background: 'rgba(15, 23, 42, 0.18)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <motion.section
              ref={closePromptRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="close-prompt-title"
              initial={{ scale: 0.92, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 10 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              onMouseDown={(event) => event.stopPropagation()}
              className="glass-panel"
              style={{
                width: 'min(420px, 100%)',
                borderRadius: '24px',
                padding: '22px',
                background: 'var(--ios-card)',
                color: 'var(--text)',
                boxShadow: '0 28px 80px rgba(0, 0, 0, 0.22)',
                border: '1px solid var(--line)',
              }}
            >
              <h3 id="close-prompt-title" style={{ margin: 0, fontSize: '18px', fontWeight: 900 }}>关闭 TuneFree？</h3>
              <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: '13px', lineHeight: 1.6 }}>
                可以让 TuneFree 留在系统托盘继续播放，也可以彻底退出应用。彻底退出时桌面歌词会一起关闭。
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px', fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rememberCloseChoice}
                  onChange={(event) => setRememberCloseChoice(event.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                />
                记住我的选择
              </label>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px', flexWrap: 'wrap' }}>
                <button ref={closePromptCancelRef} type="button" className="soft-button" onClick={() => resolveClosePrompt('cancel')}>取消</button>
                <button type="button" className="soft-button" onClick={() => resolveClosePrompt('tray')}>最小化到托盘</button>
                <button type="button" className="primary-button" onClick={() => resolveClosePrompt('exit')}>退出应用</button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
