'use client';

import { useEffect, useState } from 'react';
import { LibraryProvider } from '../core/contexts/LibraryContext';
import { PlayerProvider } from '../core/contexts/PlayerContext';
import DesktopShell from './components/DesktopShell';
import { ToastProvider } from './components/ToastHost';
import type { DesktopView } from './types';

const viewPaths: Record<DesktopView, string> = {
  home: '/',
  search: '/search',
  favorites: '/library',
  playlists: '/library/playlists',
  downloads: '/library/downloads',
  settings: '/library/settings',
  about: '/library/about',
};

const getViewFromPath = (fallback: DesktopView): DesktopView => {
  if (typeof window === 'undefined') return fallback;
  const path = window.location.pathname;
  if (path.startsWith('/search')) return 'search';
  if (path.startsWith('/library/playlists')) return 'playlists';
  if (path.startsWith('/library/downloads')) return 'downloads';
  if (path.startsWith('/library/settings')) return 'settings';
  if (path.startsWith('/library/about')) return 'about';
  if (path.startsWith('/library')) return 'favorites';
  return fallback;
};

export default function DesktopApp({ initialView = 'home' }: { initialView?: DesktopView }) {
  const [view, setView] = useState<DesktopView>(() => getViewFromPath(initialView));
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  // 禁用右键和刷新等浏览器原生行为，确保原生桌面体验
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    if (!isTauri) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'F5' ||
        (e.ctrlKey && e.key === 'r') ||
        (e.ctrlKey && e.key === 'R') ||
        (e.ctrlKey && e.shiftKey && e.key === 'I') ||
        (e.ctrlKey && e.shiftKey && e.key === 'i') ||
        (e.ctrlKey && e.shiftKey && e.key === 'R') ||
        (e.ctrlKey && e.shiftKey && e.key === 'r')
      ) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const nextView = getViewFromPath(initialView);
    setView(nextView);
  }, [initialView]);

  useEffect(() => {
    const syncViewFromPath = () => setView(getViewFromPath(initialView));
    window.addEventListener('popstate', syncViewFromPath);
    return () => window.removeEventListener('popstate', syncViewFromPath);
  }, [initialView]);

  const handleViewChange = (nextView: DesktopView) => {
    setView(nextView);
    const nextPath = viewPaths[nextView];
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
  };

  return (
    <LibraryProvider>
      <PlayerProvider>
        <ToastProvider>
          <div className="desktop-app" style={{
            opacity: isReady ? 1 : 0,
            transition: 'opacity 0.35s ease-in-out',
            height: '100%',
            width: '100%',
            backgroundColor: '#ffffff'
          }}>
            <DesktopShell view={view} onViewChange={handleViewChange} />
          </div>
        </ToastProvider>
      </PlayerProvider>
    </LibraryProvider>
  );
}
