'use client';

import { useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { DesktopPreferencesProvider } from '../core/contexts/DesktopPreferencesContext';
import { LibraryProvider } from '../core/contexts/LibraryContext';
import { PlayerProvider } from '../core/contexts/PlayerContext';
import { ThemeProvider } from '../core/contexts/ThemeContext';
import { invokeCommand, isTauri, toIpcError } from '../core/ipc';
import { setLocalServerInfo } from '../core/services/config';
import { verifyProxyAllowlist } from '../core/services/serverAllowlist';
import { DialogProvider } from './components/DialogHost';
import DesktopShell from './components/DesktopShell';
import { RecommendationSyncBridge } from './components/RecommendationSyncBridge';
import { LibrarySaveNotice } from './components/LibrarySaveNotice';
import { ToastProvider } from './components/ToastHost';
import { DownloadProvider } from './hooks/useSongDownload';
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
  const [serverReady, setServerReady] = useState(() => !isTauri());
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    void invokeCommand('get_local_server_info')
      .then((info) => {
        if (cancelled) return;
        setLocalServerInfo(info);
        setServerReady(true);
        // 端口与令牌就位后才能带鉴权访问 /api/allowed-hosts；失败只告警，不阻断启动。
        void verifyProxyAllowlist();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setServerError(`本地音乐服务启动失败：${toIpcError(error).message}`);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!serverReady || !isReady || !isTauri()) return;
    const frame = requestAnimationFrame(() => {
      void invokeCommand('mark_frontend_ready').catch((error: unknown) => {
        console.error('确认主界面启动就绪失败', error);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [isReady, serverReady]);

  // 禁用右键和刷新等浏览器原生行为，确保原生桌面体验
  useEffect(() => {
    if (!isTauri()) return;

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

  if (!serverReady) {
    return (
      <div className="desktop-app is-booting">
        <p className={`boot-notice ${serverError ? 'is-error' : ''}`}>
          {serverError || '正在启动本地音乐服务…'}
        </p>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
    <ThemeProvider>
      <DesktopPreferencesProvider>
        <LibraryProvider>
          <PlayerProvider>
            <DialogProvider>
              <ToastProvider>
                <DownloadProvider>
                  <RecommendationSyncBridge />
                  <LibrarySaveNotice />
                  <div className={`desktop-app app-root ${isReady ? 'is-ready' : ''}`}>
                    <DesktopShell view={view} onViewChange={handleViewChange} />
                  </div>
                </DownloadProvider>
              </ToastProvider>
            </DialogProvider>
          </PlayerProvider>
        </LibraryProvider>
      </DesktopPreferencesProvider>
    </ThemeProvider>
    </MotionConfig>
  );
}
