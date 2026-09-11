import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Song, Playlist, getSongKey } from '../types';
import {
  CORS_PROXY_KEY,
  DEFAULT_PROXY,
  FAVORITES_PLAYLIST_ID,
  LIBRARY_SAVE_ERROR,
  LibraryApplyImportResult,
  LibraryBackup,
  LibraryExportResult,
  LibraryImportMode,
  LibraryImportPreview,
  LibraryImportResult,
  exportLibraryData,
  getStoredValue,
  mergePlaylists,
  mergeSongLists,
  normalizePlaylistArray,
  normalizeSong,
  normalizeSongArray,
  parseLibraryImport,
  setStoredValue,
  uniqueSongs,
} from './libraryData';
import { loadLibrary, persistLibrary } from './libraryStorage';

// 兼容出口：类型定义现在统一在 libraryData 里。
export type {
  LibraryApplyImportResult,
  LibraryBackup,
  LibraryExportResult,
  LibraryImportMode,
  LibraryImportPreview,
  LibraryImportResult,
} from './libraryData';

interface LibraryContextType {
  favorites: Song[];
  playlists: Playlist[];
  corsProxy: string;
  setCorsProxy: (url: string) => void;
  saveError: { message: string } | null;
  toggleFavorite: (song: Song) => void;
  isFavorite: (songId: number | string, source?: string) => boolean;
  createPlaylist: (name: string, initialSongs?: Song[]) => void;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (playlistId: string, song: Song) => void;
  removeFromPlaylist: (
    playlistId: string,
    songId: number | string,
    source?: string,
  ) => void;
  exportData: () => LibraryExportResult;
  parseImportData: (jsonData: string) => LibraryImportResult;
  applyImportData: (
    data: LibraryImportPreview,
    mode: LibraryImportMode,
  ) => LibraryApplyImportResult;
  restoreData: (backup: LibraryBackup) => void;
  importData: (jsonData: string) => boolean;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

const createPlaylistId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [snapshot, setSnapshot] = useState<LibraryBackup>(() => loadLibrary());
  const snapshotRef = useRef(snapshot);
  const [saveError, setSaveError] = useState<{ message: string } | null>(null);
  const [corsProxy, setCorsProxyInternal] = useState<string>(
    () => getStoredValue(CORS_PROXY_KEY, DEFAULT_PROXY),
  );

  // 提交即写盘：写入失败时状态回滚，错误对外暴露为 saveError。
  const commit = useCallback((next: LibraryBackup): boolean => {
    if (!persistLibrary(next)) {
      setSaveError({ message: LIBRARY_SAVE_ERROR });
      return false;
    }
    snapshotRef.current = next;
    setSnapshot(next);
    setSaveError(null);
    return true;
  }, []);

  const { favorites, playlists } = snapshot;
  const favoriteKeys = useMemo(
    () => new Set(favorites.map(getSongKey)),
    [favorites],
  );

  const setCorsProxy = useCallback((url: string) => {
    setCorsProxyInternal(url);
    setStoredValue(CORS_PROXY_KEY, url);
  }, []);

  const toggleFavorite = useCallback(
    (song: Song) => {
      const normalized = normalizeSong(song);
      if (!normalized) return;
      const current = snapshotRef.current;
      const key = getSongKey(normalized);
      const exists = current.favorites.some((item) => getSongKey(item) === key);
      const next = exists
        ? current.favorites.filter((item) => getSongKey(item) !== key)
        : [normalized, ...current.favorites];
      commit({ ...current, favorites: next });
    },
    [commit],
  );

  const isFavorite = useCallback(
    (songId: number | string, source?: string) =>
      source
        ? favoriteKeys.has(getSongKey({ id: songId, source }))
        : favorites.some((song) => String(song.id) === String(songId)),
    [favoriteKeys, favorites],
  );

  const createPlaylist = useCallback(
    (name: string, initialSongs: Song[] = []) => {
      const playlist: Playlist = {
        id: createPlaylistId(),
        name: String(name),
        createTime: Date.now(),
        songs: uniqueSongs(
          initialSongs
            .map(normalizeSong)
            .filter((song): song is Song => Boolean(song)),
        ),
      };
      const current = snapshotRef.current;
      commit({ ...current, playlists: [playlist, ...current.playlists] });
    },
    [commit],
  );

  const renamePlaylist = useCallback(
    (id: string, name: string) => {
      const current = snapshotRef.current;
      commit({
        ...current,
        playlists: current.playlists.map((playlist) =>
          playlist.id === id ? { ...playlist, name: String(name) } : playlist,
        ),
      });
    },
    [commit],
  );

  const deletePlaylist = useCallback(
    (id: string) => {
      const current = snapshotRef.current;
      commit({
        ...current,
        playlists: current.playlists.filter((playlist) => playlist.id !== id),
      });
    },
    [commit],
  );

  const addToPlaylist = useCallback(
    (playlistId: string, song: Song) => {
      const normalized = normalizeSong(song);
      if (!normalized) return;
      const current = snapshotRef.current;
      const key = getSongKey(normalized);

      // 伪歌单「我喜欢」直接写进收藏，幂等。
      if (playlistId === FAVORITES_PLAYLIST_ID) {
        if (current.favorites.some((item) => getSongKey(item) === key)) return;
        commit({ ...current, favorites: [normalized, ...current.favorites] });
        return;
      }

      const target = current.playlists.find(
        (playlist) => playlist.id === playlistId,
      );
      if (!target) return;
      if (target.songs.some((item) => getSongKey(item) === key)) return;
      commit({
        ...current,
        playlists: current.playlists.map((playlist) =>
          playlist.id === playlistId
            ? { ...playlist, songs: [...playlist.songs, normalized] }
            : playlist,
        ),
      });
    },
    [commit],
  );

  const removeFromPlaylist = useCallback(
    (playlistId: string, songId: number | string, source?: string) => {
      const current = snapshotRef.current;
      const matches = (song: Song) =>
        String(song.id) === String(songId) &&
        (!source || song.source === source);

      if (playlistId === FAVORITES_PLAYLIST_ID) {
        commit({
          ...current,
          favorites: current.favorites.filter((song) => !matches(song)),
        });
        return;
      }

      commit({
        ...current,
        playlists: current.playlists.map((playlist) =>
          playlist.id !== playlistId
            ? playlist
            : {
                ...playlist,
                songs: playlist.songs.filter((song) => !matches(song)),
              },
        ),
      });
    },
    [commit],
  );

  const exportData = useCallback(
    (): LibraryExportResult =>
      exportLibraryData(snapshotRef.current.favorites, snapshotRef.current.playlists),
    [],
  );

  const parseImportData = useCallback(
    (jsonData: string): LibraryImportResult => parseLibraryImport(jsonData),
    [],
  );

  const applyImportData = useCallback(
    (data: LibraryImportPreview, mode: LibraryImportMode): LibraryApplyImportResult => {
      const importedFavorites = normalizeSongArray(data.favorites);
      const importedPlaylists = normalizePlaylistArray(data.playlists);
      if (!importedFavorites || !importedPlaylists) {
        return { ok: false, error: '导入数据结构不正确，未修改现有数据' };
      }
      const backup = snapshotRef.current;
      const next =
        mode === 'merge'
          ? {
              favorites: mergeSongLists(backup.favorites, importedFavorites),
              playlists: mergePlaylists(backup.playlists, importedPlaylists),
            }
          : { favorites: importedFavorites, playlists: importedPlaylists };
      return commit(next)
        ? { ok: true, backup }
        : { ok: false, error: LIBRARY_SAVE_ERROR };
    },
    [commit],
  );

  const restoreData = useCallback(
    (backup: LibraryBackup) => {
      commit(backup);
    },
    [commit],
  );

  const importData = useCallback(
    (jsonData: string): boolean => {
      const parsed = parseImportData(jsonData);
      return parsed.ok && applyImportData(parsed.data, 'replace').ok;
    },
    [applyImportData, parseImportData],
  );

  return (
    <LibraryContext.Provider
      value={{
        favorites,
        playlists,
        corsProxy,
        setCorsProxy,
        saveError,
        toggleFavorite,
        isFavorite,
        createPlaylist,
        renamePlaylist,
        deletePlaylist,
        addToPlaylist,
        removeFromPlaylist,
        exportData,
        parseImportData,
        applyImportData,
        restoreData,
        importData,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
};

const LIBRARY_DEFAULTS: LibraryContextType = {
  favorites: [],
  playlists: [],
  corsProxy: "",
  setCorsProxy: () => {},
  saveError: null,
  toggleFavorite: () => {},
  isFavorite: () => false,
  createPlaylist: () => {},
  renamePlaylist: () => {},
  deletePlaylist: () => {},
  addToPlaylist: () => {},
  removeFromPlaylist: () => {},
  exportData: () => ({ ok: false, error: "资料库未就绪" }),
  parseImportData: () => ({ ok: false, error: "资料库未就绪" }),
  applyImportData: () => ({ ok: false, error: "资料库未就绪" }),
  restoreData: () => {},
  importData: () => false,
};

export const useLibrary = () => {
  const context = useContext(LibraryContext);
  if (!context) {
    console.warn("[useLibrary] Provider 未就绪，返回默认值（HMR 热更新中）");
    return LIBRARY_DEFAULTS;
  }
  return context;
};
