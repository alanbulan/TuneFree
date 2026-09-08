import { useCallback, useMemo, useRef, useState } from 'react';

import { logRecommendationEvent } from '../services/recommendation';
import { getSongKey, type Playlist, type Song } from '../types';
import {
  CORS_PROXY_KEY, DEFAULT_PROXY, exportLibraryData, getStoredValue,
  mergePlaylists, mergeSongLists, normalizePlaylistArray, normalizeSong,
  normalizeSongArray, parseLibraryImport as parseImportData, setStoredValue, uniqueSongs,
  type LibraryActions, type LibraryApplyImportResult, type LibraryBackup,
  type LibraryData, type LibraryExportResult, type LibraryImportMode,
  type LibraryImportPreview, type LibraryProxy,
} from './libraryData';
import { LIBRARY_SAVE_ERROR, loadLibrary, persistLibrary } from './libraryStorage';

export interface LibraryStore {
  dataValue: LibraryData;
  actionsValue: LibraryActions;
  proxyValue: LibraryProxy;
}

const FAVORITES_PLAYLIST_ID = 'favorites';
const matchesSong = (song: Song, songId: number | string, source?: string) =>
  String(song.id) === String(songId) && (!source || song.source === source);

export const useLibraryStore = (): LibraryStore => {
  const [snapshot, setSnapshot] = useState(loadLibrary);
  const snapshotRef = useRef(snapshot);
  const { favorites, playlists: playlistsState } = snapshot;
  const [saveError, setSaveError] = useState<{ message: string } | null>(null);
  const [corsProxy, setCorsProxyInternal] = useState(
    () => getStoredValue(CORS_PROXY_KEY, DEFAULT_PROXY),
  );

  const commit = useCallback((next: LibraryBackup, reportError = true): boolean => {
    if (!persistLibrary(next)) {
      if (reportError) setSaveError({ message: LIBRARY_SAVE_ERROR });
      return false;
    }
    // 同步推进引用，连续操作不依赖 React 的下一次渲染。
    snapshotRef.current = next;
    setSnapshot(next);
    setSaveError(null);
    return true;
  }, []);

  const playlists = useMemo<Playlist[]>(() => [
    { id: FAVORITES_PLAYLIST_ID, name: '我喜欢', createTime: 0, songs: favorites },
    ...playlistsState,
  ], [favorites, playlistsState]);
  const favoriteKeys = useMemo(() => new Set(favorites.map(getSongKey)), [favorites]);
  const favoriteIds = useMemo(() => new Set(favorites.map((song) => String(song.id))), [favorites]);
  const isFavorite = useCallback(
    (songId: number | string, source?: string) => source
      ? favoriteKeys.has(getSongKey({ id: songId, source })) : favoriteIds.has(String(songId)),
    [favoriteIds, favoriteKeys],
  );

  const setCorsProxy = useCallback((url: string) => {
    if (!setStoredValue(CORS_PROXY_KEY, url)) {
      setSaveError({ message: '代理设置保存失败，请检查可用存储空间' });
      return false;
    }
    setCorsProxyInternal(url);
    return true;
  }, []);

  const toggleFavorite = useCallback((song: Song) => {
    const normalized = normalizeSong(song);
    if (!normalized) return false;
    const current = snapshotRef.current;
    const key = getSongKey(normalized);
    const exists = current.favorites.some((item) => getSongKey(item) === key);
    const next = exists ? current.favorites.filter((item) => getSongKey(item) !== key)
      : [normalized, ...current.favorites];
    if (!commit({ ...current, favorites: next })) return false;
    void logRecommendationEvent({
      eventType: exists ? 'favorite_remove' : 'favorite_add', song: normalized, context: 'library',
    }).catch(() => {});
    return true;
  }, [commit]);

  const createPlaylist = useCallback((name: string, initialSongs: Song[] = []) => {
    const playlist: Playlist = {
      id: crypto.randomUUID(), name: String(name), createTime: Date.now(),
      songs: uniqueSongs(initialSongs.map(normalizeSong).filter((song): song is Song => Boolean(song))),
    };
    const current = snapshotRef.current;
    return commit({ ...current, playlists: [playlist, ...current.playlists] });
  }, [commit]);

  const renamePlaylist = useCallback((id: string, name: string) => {
    if (id === FAVORITES_PLAYLIST_ID) return false;
    const current = snapshotRef.current;
    return commit({ ...current, playlists: current.playlists.map((playlist) =>
      playlist.id === id ? { ...playlist, name: String(name) } : playlist) });
  }, [commit]);

  const deletePlaylist = useCallback((id: string) => {
    if (id === FAVORITES_PLAYLIST_ID) return false;
    const current = snapshotRef.current;
    return commit({ ...current, playlists: current.playlists.filter((playlist) => playlist.id !== id) });
  }, [commit]);

  const addToPlaylist = useCallback((playlistId: string, song: Song) => {
    const normalized = normalizeSong(song);
    if (!normalized) return false;
    const current = snapshotRef.current;
    const key = getSongKey(normalized);
    const target = playlistId === FAVORITES_PLAYLIST_ID ? current.favorites
      : current.playlists.find((playlist) => playlist.id === playlistId)?.songs;
    if (!target) return false;
    if (target.some((item) => getSongKey(item) === key)) return true;
    const next = playlistId === FAVORITES_PLAYLIST_ID
      ? { ...current, favorites: [normalized, ...current.favorites] }
      : { ...current, playlists: current.playlists.map((playlist) => playlist.id === playlistId
        ? { ...playlist, songs: [...playlist.songs, normalized] } : playlist) };
    if (!commit(next)) return false;
    void logRecommendationEvent({ eventType: playlistId === FAVORITES_PLAYLIST_ID
      ? 'favorite_add' : 'playlist_add', song: normalized, context: `playlist:${playlistId}`,
    }).catch(() => {});
    return true;
  }, [commit]);

  const removeFromPlaylist = useCallback((playlistId: string, songId: number | string, source?: string) => {
    const current = snapshotRef.current;
    return commit(playlistId === FAVORITES_PLAYLIST_ID
      ? { ...current, favorites: current.favorites.filter((song) => !matchesSong(song, songId, source)) }
      : { ...current, playlists: current.playlists.map((playlist) => playlist.id !== playlistId
        ? playlist : { ...playlist, songs: playlist.songs.filter((song) => !matchesSong(song, songId, source)) }) });
  }, [commit]);

  const exportData = useCallback((): LibraryExportResult =>
    exportLibraryData(snapshotRef.current.favorites, snapshotRef.current.playlists), []);
  const applyImportData = useCallback((
    data: LibraryImportPreview, mode: LibraryImportMode = 'replace',
  ): LibraryApplyImportResult => {
    const importedFavorites = normalizeSongArray(data.favorites);
    const importedPlaylists = normalizePlaylistArray(data.playlists);
    if (!importedFavorites || !importedPlaylists) {
      return { ok: false, error: '导入数据结构不正确，未修改现有数据' };
    }
    const backup = snapshotRef.current;
    const next = mode === 'merge' ? {
      favorites: mergeSongLists(backup.favorites, importedFavorites),
      playlists: mergePlaylists(backup.playlists, importedPlaylists),
    } : { favorites: importedFavorites, playlists: importedPlaylists };
    return commit(next, false) ? { ok: true, backup } : { ok: false, error: LIBRARY_SAVE_ERROR };
  }, [commit]);
  const restoreData = useCallback((backup: LibraryBackup) => commit(backup), [commit]);
  const importData = useCallback((jsonData: string): boolean => {
    const parsed = parseImportData(jsonData);
    return parsed.ok && applyImportData(parsed.data, 'replace').ok;
  }, [applyImportData]);

  const dataValue = useMemo<LibraryData>(
    () => ({ favorites, playlists, isFavorite, saveError }), [favorites, isFavorite, playlists, saveError],
  );
  const actionsValue = useMemo<LibraryActions>(() => ({
    toggleFavorite, createPlaylist, renamePlaylist, deletePlaylist,
    addToPlaylist, removeFromPlaylist, exportData, parseImportData,
    applyImportData, restoreData, importData,
  }), [addToPlaylist, applyImportData, createPlaylist, deletePlaylist, exportData,
    importData, removeFromPlaylist, renamePlaylist, restoreData, toggleFavorite]);
  const proxyValue = useMemo<LibraryProxy>(
    () => ({ corsProxy, setCorsProxy }), [corsProxy, setCorsProxy],
  );
  return { dataValue, actionsValue, proxyValue };
};
