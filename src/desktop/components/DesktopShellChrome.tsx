import type { FormEvent } from 'react';
import { DownloadIcon, HeartIcon, HomeIcon, InfoIcon, LibraryIcon, SearchIcon,
  SettingsIcon, SidebarCollapseIcon, SidebarExpandIcon } from '../../core/components/Icons';
import { Laptop, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../core/contexts/ThemeContext';
import { getCurrentWindow, isTauri } from '../../core/ipc';
import type { DesktopView } from '../types';

const navItems: { view: DesktopView; label: string; icon: React.ReactNode }[] = [
  { view: 'home', label: '首页', icon: <HomeIcon size={17} /> },
  { view: 'search', label: '搜索', icon: <SearchIcon size={17} /> },
  { view: 'favorites', label: '收藏', icon: <HeartIcon size={17} /> },
  { view: 'playlists', label: '歌单', icon: <LibraryIcon size={17} /> },
  { view: 'downloads', label: '下载', icon: <DownloadIcon size={17} /> },
  { view: 'settings', label: '管理', icon: <SettingsIcon size={17} /> },
  { view: 'about', label: '关于', icon: <InfoIcon size={17} /> },
];

const handleWindowControl = async (action: 'minimize' | 'maximize' | 'close') => {
  if (!isTauri()) return;
  try {
    const appWindow = getCurrentWindow();
    if (action === 'minimize') await appWindow.minimize();
    else if (action === 'maximize') await appWindow.toggleMaximize();
    else await appWindow.close();
  } catch (error) {
    console.error('Failed to control window:', error);
  }
};

interface WindowBarProps {
  view: DesktopView;
  commandQuery: string;
  onCommandQueryChange: (query: string) => void;
  onCommandSearch: (event: FormEvent<HTMLFormElement>) => void;
}

export function WindowBar({ view, commandQuery, onCommandQueryChange, onCommandSearch }: WindowBarProps) {
  const { themeMode, setThemeMode } = useTheme();
  const themeLabel = themeMode === 'light' ? '浅色' : themeMode === 'dark' ? '深色' : '随系统';
  const nextThemeMode = themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light';
  const nextThemeLabel = nextThemeMode === 'light' ? '浅色' : nextThemeMode === 'dark' ? '深色' : '随系统';
  return (
    <header className="window-bar" data-tauri-drag-region>
      <div className="window-brand-zone" data-tauri-drag-region>
        <div className="window-brand-lockup" aria-label="TuneFree Desktop" data-tauri-drag-region>
          <img className="brand-mark" src="/icon.svg" alt="" aria-hidden="true" data-tauri-drag-region />
          <span data-tauri-drag-region>TuneFree</span>
        </div>
        <button type="button" className="theme-toggle-btn brand-theme-toggle"
          title={`当前主题：${themeLabel}\n点击切换到${nextThemeLabel}`}
          aria-label={`当前主题：${themeLabel}，点击切换到${nextThemeLabel}`}
          onClick={() => setThemeMode(nextThemeMode)}>
          {themeMode === 'light' && <Sun size={14} />}
          {themeMode === 'dark' && <Moon size={14} />}
          {themeMode === 'system' && <Laptop size={14} />}
        </button>
      </div>
      <div className="window-bar-search-zone" data-tauri-drag-region>
        {view !== 'search' && (
          <form className="command-search" onSubmit={onCommandSearch}>
            <SearchIcon size={15} />
            <input aria-label="搜索音乐" value={commandQuery}
              onChange={(event) => onCommandQueryChange(event.target.value)} placeholder="搜索" />
          </form>
        )}
        <div className="window-bar-drag-filler" data-tauri-drag-region />
      </div>
      {isTauri() ? (
        <div className="window-controls">
          <button className="win-btn minimize" onClick={() => void handleWindowControl('minimize')} data-tooltip="最小化" aria-label="最小化" />
          <button className="win-btn maximize" onClick={() => void handleWindowControl('maximize')} data-tooltip="最大化" aria-label="最大化" />
          <button className="win-btn close" onClick={() => void handleWindowControl('close')} data-tooltip="关闭" aria-label="关闭" />
        </div>
      ) : <div />}
    </header>
  );
}

interface SidebarProps {
  view: DesktopView;
  collapsed: boolean;
  onToggle: () => void;
  onViewChange: (view: DesktopView) => void;
}

export function DesktopSidebar({ view, collapsed, onToggle, onViewChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-topline">
        <button type="button" className="sidebar-toggle"
          aria-label={collapsed ? '展开侧边菜单' : '收起侧边菜单'}
          title={collapsed ? '展开侧边菜单' : '收起侧边菜单'} onClick={onToggle}>
          {collapsed ? <SidebarExpandIcon size={16} /> : <SidebarCollapseIcon size={16} />}
        </button>
      </div>
      <p className="sidebar-section-title">TuneFree</p>
      <nav className="nav-group" aria-label="主导航">
        {navItems.map((item) => (
          <button key={item.view} type="button"
            className={`nav-button ${view === item.view ? 'active' : ''}`}
            aria-current={view === item.view ? 'page' : undefined} title={item.label}
            onClick={() => onViewChange(item.view)}>
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
