import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logRecommendationEvent } from '../services/recommendation';
import { getSongKey, type Playlist, type Song } from '../types';
import {
  CORS_PROXY_KEY,
  DEFAULT_PROXY,
  FAVORITES_KEY,
  PLAYLISTS_KEY,
  exportLibraryData,
  getStoredJson,
  getStoredValue,
  mergePlaylists,
  mergeSongLists,
  normalizePlaylistArray,
  normalizeSong,
  normalizeSongArray,
  parseLibraryImport,
  setStoredValue,
  uniqueSongs,
  type LibraryActions,
  type LibraryApplyImportResult,
  type LibraryBackup,
  type LibraryData,
  type LibraryExportResult,
  type LibraryImportMode,
  type LibraryImportPreview,
  type LibraryProxy,
} from './libraryData';

export interface LibraryStore {
  dataValue: LibraryData;
  actionsValue: LibraryActions;
  proxyValue: LibraryProxy;
}

const FAVORITES_PLAYLIST_ID = 'favorites';

const matchesSong = (song: Song, songId: number | string, source?: string) =>
  String(song.id) === String(songId) && (!source || song.source === source);

export const useLibraryStore = (): LibraryStore => {
  const [favorites, setFavorites] = useState<Song[]>(() =>
    getStoredJson<Song[]>(FAVORITES_KEY, [], normalizeSongArray),
  );
  const [playlistsState, setPlaylistsState] = useState<Playlist[]>(() =>
    getStoredJson<Playlist[]>(PLAYLISTS_KEY, [], normalizePlaylistArray),
  );
  const [corsProxy, setCorsProxyInternal] = useState<string>(
    () => getStoredValue(CORS_PROXY_KEY, DEFAULT_PROXY),
  );

  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;
  const playlistsRef = useRef(playlistsState);
  playlistsRef.current = playlistsState;

  useEffect(() => {
    setStoredValue(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    setStoredValue(PLAYLISTS_KEY, JSON.stringify(playlistsState));
  }, [playlistsState]);

  const playlists = useMemo<Playlist[]>(() => [
    { id: FAVORITES_PLAYLIST_ID, name: '我喜欢', createTime: 0, songs: favorites },
    ...playlistsState,
  ], [favorites, playlistsState]);

  // 线性扫描 favorites 会让每次收藏判断都变成 O(N)，这里换成 O(1) 的键集合。
  const favoriteKeys = useMemo(() => new Set(favorites.map(getSongKey)), [favorites]);
  const favoriteIds = useMemo(
    () => new Set(favorites.map((song) => String(song.id))), [favorites],
  );

  const isFavorite = useCallback(
    (songId: number | string, source?: string) => source
      ? favoriteKeys.has(getSongKey({ id: songId, source }))
      : favoriteIds.has(String(songId)),
    [favoriteIds, favoriteKeys],
  );

  const setCorsProxy = useCallback((url: string) => {
    setCorsProxyInternal(url);
    setStoredValue(CORS_PROXY_KEY, url);
  }, []);

  const addFavorite = useCallback((song: Song, songKey: string) => {
    setFavorites((previous) => previous.some((item) => getSongKey(item) === songKey)
      ? previous : [song, ...previous]);
  }, []);

  const toggleFavorite = useCallback((song: Song) => {
    const normalizedSong = normalizeSong(song);
    if (!normalizedSong) return;
    const songKey = getSongKey(normalizedSong);
    const wasFavorite = favoritesRef.current.some((item) => getSongKey(item) === songKey);
    void logRecommendationEvent({
      eventType: wasFavorite ? 'favorite_remove' : 'favorite_add',
      song: normalizedSong,
      context: 'library',
    }).catch(() => {});
    if (wasFavorite) {
      setFavorites((previous) => previous.filter((item) => getSongKey(item) !== songKey));
      return;
    }
    addFavorite(normalizedSong, songKey);
  }, [addFavorite]);

  const createPlaylist = useCallback((name: string, initialSongs: Song[] = []) => {
    const newPlaylist: Playlist = {
      id: Date.now().toString(),
      name: String(name),
      createTime: Date.now(),
      songs: uniqueSongs(
        initialSongs.map(normalizeSong).filter((song): song is Song => Boolean(song)),
      ),
    };
    setPlaylistsState((previous) => [newPlaylist, ...previous]);
  }, []);

  const renamePlaylist = useCallback((id: string, name: string) => {
    if (id === FAVORITES_PLAYLIST_ID) return;
    setPlaylistsState((previous) =>
      previous.map((playlist) =>
        playlist.id === id ? { ...playlist, name: String(name) } : playlist),
    );
  }, []);

  const deletePlaylist = useCallback((id: string) => {
    if (id === FAVORITES_PLAYLIST_ID) return;
    setPlaylistsState((previous) => previous.filter((playlist) => playlist.id !== id));
  }, []);

  const addToPlaylist = useCallback((playlistId: string, song: Song) => {
    const normalizedSong = normalizeSong(song);
    if (!normalizedSong) return;
    const songKey = getSongKey(normalizedSong);
    if (playlistId === FAVORITES_PLAYLIST_ID) {
      if (!favoritesRef.current.some((item) => getSongKey(item) === songKey)) {
        void logRecommendationEvent({
          eventType: 'favorite_add', song: normalizedSong, context: 'library',
        }).catch(() => {});
      }
      addFavorite(normalizedSong, songKey);
      return;
    }
    const targetPlaylist = playlistsRef.current.find((playlist) => playlist.id === playlistId);
    if (!targetPlaylist?.songs.some((item) => getSongKey(item) === songKey)) {
      void logRecommendationEvent({
        eventType: 'playlist_add', song: normalizedSong, context: `playlist:${playlistId}`,
      }).catch(() => {});
    }
    setPlaylistsState((previous) => previous.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      if (playlist.songs.some((item) => getSongKey(item) === songKey)) return playlist;
      return { ...playlist, songs: [...playlist.songs, normalizedSong] };
    }));
  }, [addFavorite]);

  const removeFromPlaylist = useCallback(
    (playlistId: string, songId: number | string, source?: string) => {
      if (playlistId === FAVORITES_PLAYLIST_ID) {
        setFavorites((previous) =>
          previous.filter((song) => !matchesSong(song, songId, source)));
        return;
      }
      setPlaylistsState((previous) => previous.map((playlist) => playlist.id !== playlistId
        ? playlist
        : {
          ...playlist,
          songs: playlist.songs.filter((song) => !matchesSong(song, songId, source)),
        }));
    },
    [],
  );

  const exportData = useCallback((): LibraryExportResult =>
    exportLibraryData(favoritesRef.current, playlistsRef.current), []);

  const parseImportData = useCallback(parseLibraryImport, []);

  const applyImportData = useCallback(
    (
      data: LibraryImportPreview,
      mode: LibraryImportMode = 'replace',
    ): LibraryApplyImportResult => {
      const favoritesToApply = normalizeSongArray(data.favorites);
      const playlistsToApply = normalizePlaylistArray(data.playlists);
      if (!favoritesToApply || !playlistsToApply) {
        return { ok: false, error: '导入数据结构不正确，未修改现有数据' };
      }
      const backup = { favorites: favoritesRef.current, playlists: playlistsRef.current };
      if (mode === 'merge') {
        setFavorites((previous) => mergeSongLists(previous, favoritesToApply));
        setPlaylistsState((previous) => mergePlaylists(previous, playlistsToApply));
      } else {
        setFavorites(favoritesToApply);
        setPlaylistsState(playlistsToApply);
      }
      return { ok: true, backup };
    },
    [],
  );

  const restoreData = useCallback((backup: LibraryBackup) => {
    setFavorites(backup.favorites);
    setPlaylistsState(backup.playlists);
  }, []);

  const importData = useCallback((jsonData: string): boolean => {
    const parsed = parseImportData(jsonData);
    if (!parsed.ok) return false;
    return applyImportData(parsed.data, 'replace').ok;
  }, [applyImportData, parseImportData]);

  const dataValue = useMemo<LibraryData>(
    () => ({ favorites, playlists, isFavorite }), [favorites, isFavorite, playlists],
  );
  // 全部 useCallback 身份恒定，因此该对象在 Provider 生命周期内只创建一次。
  const actionsValue = useMemo<LibraryActions>(() => ({
    toggleFavorite, createPlaylist, renamePlaylist, deletePlaylist,
    addToPlaylist, removeFromPlaylist, exportData, parseImportData,
    applyImportData, restoreData, importData,
  }), [addToPlaylist, applyImportData, createPlaylist, deletePlaylist, exportData,
    importData, parseImportData, removeFromPlaylist, renamePlaylist, restoreData,
    toggleFavorite]);
  const proxyValue = useMemo<LibraryProxy>(
    () => ({ corsProxy, setCorsProxy }), [corsProxy, setCorsProxy],
  );

  return { dataValue, actionsValue, proxyValue };
};
