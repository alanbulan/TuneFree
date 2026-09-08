import { useEffect, useRef, useState } from 'react';
import { useLibraryData } from '../../core/contexts/LibraryContext';
import { isTauri, listenEvent, toIpcError } from '../../core/ipc';
import {
  getLlmConfig, syncRecommendationLibrary, RECOMMENDATION_CHANGED_EVENT,
  type LibraryDelta, type LibraryMembershipChange,
} from '../../core/services/recommendation';
import { getSongKey, type Song } from '../../core/types';

export function RecommendationSyncBridge() {
  // 只订阅曲库数据切片，避免收藏/歌单以外的变更触发同步重算。
  const { favorites, playlists } = useLibraryData();
  const [revision, setRevision] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const syncedMembershipsRef = useRef<Map<string, RecommendationMembership> | null>(null);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const syncVersionRef = useRef(0);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let availabilityRequest = 0;
    let unlisten: (() => void) | undefined;
    const refresh = () => {
      const request = ++availabilityRequest;
      syncVersionRef.current += 1;
      syncedMembershipsRef.current = null;
      void getLlmConfig().then((config) => {
        if (disposed || request !== availabilityRequest) return;
        setEnabled(config.localRecommendationEnabled);
        setRevision(syncVersionRef.current);
      }).catch((error: unknown) => {
        if (!disposed && toIpcError(error).code !== 'BUSY') console.warn('读取推荐同步状态失败', error);
      });
    };
    window.addEventListener(RECOMMENDATION_CHANGED_EVENT, refresh);
    void listenEvent('recommendation-ready', refresh).then((dispose) => {
      if (disposed) { dispose(); return; }
      unlisten = dispose;
      refresh();
    }).catch((error: unknown) => { console.warn('订阅推荐就绪事件失败', error); refresh(); });
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener(RECOMMENDATION_CHANGED_EVENT, refresh);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const syncVersion = revision;
    const isObsolete = () => cancelled || syncVersion !== syncVersionRef.current;
    const syncedPlaylists = playlists.filter((playlist) => playlist.id !== 'favorites');
    const nextMemberships = buildRecommendationMemberships(favorites, syncedPlaylists);
    syncQueueRef.current = syncQueueRef.current
      .catch(() => {})
      .then(async () => {
        if (isObsolete()) return;
        const previousMemberships = syncedMembershipsRef.current;
        if (!previousMemberships) {
          const synced = await syncRecommendationLibrary({
            favorites,
            playlists: syncedPlaylists,
            queue: [],
            currentSong: null,
          });
          if (!synced || isObsolete()) { syncedMembershipsRef.current = null; return; }
        } else {
          const delta = buildRecommendationLibraryDelta(previousMemberships, nextMemberships);
          if (
            delta.upsertSongs.length > 0 ||
            delta.addedMemberships.length > 0 ||
            delta.removedMemberships.length > 0
          ) {
            const synced = await syncRecommendationLibrary({
              favorites: [],
              playlists: [],
              queue: [],
              currentSong: null,
              delta,
            });
            if (!synced || isObsolete()) { syncedMembershipsRef.current = null; return; }
          }
        }
        syncedMembershipsRef.current = nextMemberships;
      })
      .catch((error: unknown) => {
        syncedMembershipsRef.current = null;
        if (toIpcError(error).code !== 'BUSY') console.warn('曲库推荐同步失败', error);
      });
    return () => { cancelled = true; };
  }, [enabled, favorites, playlists, revision]);

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
