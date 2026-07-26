'use client';

import { useEffect, useRef, useState } from 'react';
import { DesktopPreferencesProvider } from '../core/contexts/DesktopPreferencesContext';
import { LibraryProvider, useLibraryData } from '../core/contexts/LibraryContext';
import { PlayerProvider } from '../core/contexts/PlayerContext';
import { ThemeProvider } from '../core/contexts/ThemeContext';
import { invokeCommand, isTauri, toIpcError } from '../core/ipc';
import { setLocalServerInfo } from '../core/services/config';
import {
  syncRecommendationLibrary,
  type LibraryDelta,
  type LibraryMembershipChange,
} from '../core/services/recommendation';
import { verifyProxyAllowlist } from '../core/services/serverAllowlist';
import { getSongKey, type Song } from '../core/types';
import { DialogProvider } from './components/DialogHost';
import DesktopShell from './components/DesktopShell';
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

function RecommendationSyncBridge() {
  // 只订阅曲库数据切片，避免收藏/歌单以外的变更触发同步重算。
  const { favorites, playlists } = useLibraryData();
  const syncedMembershipsRef = useRef<Map<string, RecommendationMembership> | null>(null);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const syncedPlaylists = playlists.filter((playlist) => playlist.id !== 'favorites');
    const nextMemberships = buildRecommendationMemberships(favorites, syncedPlaylists);
    syncQueueRef.current = syncQueueRef.current
      .catch(() => {})
      .then(async () => {
        const previousMemberships = syncedMembershipsRef.current;
        if (!previousMemberships) {
          await syncRecommendationLibrary({
            favorites,
            playlists: syncedPlaylists,
            queue: [],
            currentSong: null,
          });
        } else {
          const delta = buildRecommendationLibraryDelta(previousMemberships, nextMemberships);
          if (
            delta.upsertSongs.length > 0 ||
            delta.addedMemberships.length > 0 ||
            delta.removedMemberships.length > 0
          ) {
            await syncRecommendationLibrary({
              favorites: [],
              playlists: [],
              queue: [],
              currentSong: null,
              delta,
            });
          }
        }
        syncedMembershipsRef.current = nextMemberships;
      })
      .catch(() => {
        syncedMembershipsRef.current = null;
      });
  }, [favorites, playlists]);

  return null;
}

interface RecommendationMembership {
  change: LibraryMembershipChange;
  song: Song;
  songSignature: string;
}

function buildRecommendationMemberships(
  favorites: Song[],
  playlists: Array<{ id: string; songs: Song[] }>,
): Map<string, RecommendationMembership> {
  const memberships = new Map<string, RecommendationMembership>();
  const addMembership = (
    containerType: LibraryMembershipChange['containerType'],
    containerId: string,
    song: Song,
  ) => {
    const trackKey = getSongKey(song);
    const change = { containerType, containerId, trackKey };
    memberships.set(`${containerType}:${containerId}:${trackKey}`, {
      change,
      song,
      songSignature: recommendationSongSignature(song),
    });
  };

  favorites.forEach((song) => addMembership('favorite', 'favorites', song));
  playlists.forEach((playlist) => {
    playlist.songs.forEach((song) => addMembership('playlist', playlist.id, song));
  });
  return memberships;
}

function buildRecommendationLibraryDelta(
  previous: Map<string, RecommendationMembership>,
  next: Map<string, RecommendationMembership>,
): LibraryDelta {
  const addedMemberships: LibraryMembershipChange[] = [];
  const removedMemberships: LibraryMembershipChange[] = [];
  const upsertSongs = new Map<string, Song>();

  next.forEach((membership, membershipKey) => {
    const previousMembership = previous.get(membershipKey);
    if (!previousMembership) {
      addedMemberships.push(membership.change);
      upsertSongs.set(membership.change.trackKey, membership.song);
    } else if (previousMembership.songSignature !== membership.songSignature) {
      upsertSongs.set(membership.change.trackKey, membership.song);
    }
  });
  previous.forEach((membership, membershipKey) => {
    if (!next.has(membershipKey)) removedMemberships.push(membership.change);
  });

  return {
    upsertSongs: Array.from(upsertSongs.values()),
    addedMemberships,
    removedMemberships,
  };
}

function recommendationSongSignature(song: Song): string {
  return JSON.stringify({
    id: song.id,
    source: song.source,
    name: song.name,
    artist: song.artist,
    album: song.album,
    pic: song.pic,
    picId: song.picId,
    urlId: song.urlId,
    lyricId: song.lyricId,
    types: song.types,
  });
}

export default function DesktopApp({ initialView = 'home' }: { initialView?: DesktopView }) {
  const [view, setView] = useState<DesktopView>(() => getViewFromPath(initialView));
  const [isReady, setIsReady] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    if (!isTauri()) {
      setServerReady(true);
      return;
    }

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
    <ThemeProvider>
      <DesktopPreferencesProvider>
        <LibraryProvider>
          <PlayerProvider>
            <DialogProvider>
              <ToastProvider>
                <DownloadProvider>
                  <RecommendationSyncBridge />
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
  );
}
