import { FormEvent, useEffect, useState, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { DownloadIcon, HeartIcon, HomeIcon, InfoIcon, LibraryIcon, SearchIcon, SettingsIcon, SidebarCollapseIcon, SidebarExpandIcon } from '../../core/components/Icons';
import { usePlayerNotice, usePlayerNowPlaying, usePlayerProgress, usePlayerActions } from '../../core/contexts/PlayerContext';
import { useTheme } from '../../core/contexts/ThemeContext';
import DesktopHome from '../features/home/DesktopHome';
import DesktopLibrary from '../features/library/DesktopLibrary';
import DesktopSearch from '../features/search/DesktopSearch';
import type { DesktopView, LibraryView } from '../types';
import DesktopFullPlayer from './DesktopFullPlayer';
import DesktopTransport from './DesktopTransport';
import MiraPet from './MiraPet';
import { useToast } from './ToastHost';

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
  ((window as any).__TAURI_INTERNALS__ !== undefined || (window as any).__TAURI__ !== undefined);

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
  const { playerNotice } = usePlayerNotice();
  const { showToast } = useToast();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { currentTime, duration } = usePlayerProgress();
  const { togglePlay, playNext, playPrev, seek } = usePlayerActions();
  const { showDesktopLyric, setShowDesktopLyric, lockDesktopLyric, setLockDesktopLyric, lyricSize, setLyricSize } = useTheme();
  const [commandQuery, setCommandQuery] = useState('');
  const [searchRequest, setSearchRequest] = useState({ query: '', nonce: 0 });
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const lyricSizeRef = useRef(lyricSize);
  const lockDesktopLyricRef = useRef(lockDesktopLyric);

  useEffect(() => {
    lyricSizeRef.current = lyricSize;
    lockDesktopLyricRef.current = lockDesktopLyric;
  }, [lyricSize, lockDesktopLyric]);

  useEffect(() => {
    if (playerNotice) showToast(playerNotice.message, playerNotice.tone);
  }, [playerNotice, showToast]);

  // 跨窗口同步播放进度和状态给桌面歌词窗口
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
        });
      } catch (e) {
        console.error('Failed to emit lyric-update:', e);
      }
    };

    syncLyric();
  }, [currentSong, isPlaying, currentTime, duration, showDesktopLyric]);

  // 监听歌词窗口回传的播放控制事件
  useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unsub = await listen<{ action: string; value?: any }>('player-control', (event) => {
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
            showToast(nextLock ? '桌面歌词已锁定（鼠标穿透）' : '桌面歌词已解锁', 'info');
          } else if (action === 'adjust-lyric-size') {
            const nextSize = Math.max(14, Math.min(36, lyricSizeRef.current + Number(value)));
            setLyricSize(nextSize);
          } else if (action === 'close-lyric') {
            setShowDesktopLyric(false);
          }
        });
        unlisten = unsub;
      } catch (e) {
        console.error('Failed to listen to player-control:', e);
      }
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [togglePlay, playNext, playPrev, seek, setLockDesktopLyric, setLyricSize, setShowDesktopLyric, showToast]);

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
      <header className="window-bar" data-tauri-drag-region style={{ height: '100%' }}>
        <div className="window-brand-lockup" aria-label="TuneFree Desktop" data-tauri-drag-region>
          <img className="brand-mark" src="/icon.svg" alt="" aria-hidden="true" data-tauri-drag-region />
          <span data-tauri-drag-region>TuneFree</span>
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
            <button className="win-btn minimize" onClick={() => handleWindowControl('minimize')} data-tooltip="最小化" aria-label="Minimize" />
            <button className="win-btn maximize" onClick={() => handleWindowControl('maximize')} data-tooltip="最大化" aria-label="Maximize" />
            <button className="win-btn close" onClick={() => handleWindowControl('close')} data-tooltip="关闭" aria-label="Close" />
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
            {sidebarCollapsed ? <SidebarExpandIcon size={20} /> : <SidebarCollapseIcon size={20} />}
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
    </div>
  );
}
