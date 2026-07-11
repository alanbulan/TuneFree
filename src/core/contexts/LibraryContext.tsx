import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Song, Playlist, getSongKey } from "../types";
import { logRecommendationEvent } from "../services/recommendation";
import {
  CORS_PROXY_KEY,
  DEFAULT_PROXY,
  FAVORITES_KEY,
  PLAYLISTS_KEY,
  getStoredJson,
  getStoredValue,
  exportLibraryData,
  mergePlaylists,
  mergeSongLists,
  normalizePlaylistArray,
  normalizeSong,
  normalizeSongArray,
  parseLibraryImport,
  setStoredValue,
  uniqueSongs,
  type LibraryApplyImportResult,
  type LibraryBackup,
  type LibraryExportResult,
  type LibraryImportMode,
  type LibraryImportPreview,
  type LibraryContextValue,
} from './libraryData';
import { LibraryContext } from './libraryContextValue';

export { useLibrary } from './libraryContextValue';

export type {
  LibraryApplyImportResult,
  LibraryBackup,
  LibraryExportResult,
  LibraryImportMode,
  LibraryImportPreview,
  LibraryImportResult,
} from './libraryData';

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
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
  const playlistsRef = useRef(playlistsState);
  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);
  useEffect(() => {
    playlistsRef.current = playlistsState;
  }, [playlistsState]);

  useEffect(() => {
    setStoredValue(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    setStoredValue(PLAYLISTS_KEY, JSON.stringify(playlistsState));
  }, [playlistsState]);

  const playlists = useMemo(() => {
    const favPlaylist: Playlist = {
      id: "favorites",
      name: "我喜欢",
      createTime: 0,
      songs: favorites,
    };
    return [favPlaylist, ...playlistsState];
  }, [favorites, playlistsState]);

  const setCorsProxy = useCallback((url: string) => {
    setCorsProxyInternal(url);
    setStoredValue(CORS_PROXY_KEY, url);
  }, []);

  const toggleFavorite = useCallback((song: Song) => {
    const normalizedSong = normalizeSong(song);
    if (!normalizedSong) return;
    const songKey = getSongKey(normalizedSong);
    const wasFavorite = favoritesRef.current.some((s) => getSongKey(s) === songKey);
    void logRecommendationEvent({
      eventType: wasFavorite ? "favorite_remove" : "favorite_add",
      song: normalizedSong,
      context: "library",
    }).catch(() => {});
    setFavorites((prev) => {
      if (prev.find((s) => getSongKey(s) === songKey)) {
        return prev.filter((s) => getSongKey(s) !== songKey);
      }
      return [normalizedSong, ...prev];
    });
  }, []);

  const isFavorite = useCallback(
    (songId: number | string, source?: string) =>
      favorites.some(
        (s) =>
          String(s.id) === String(songId) && (!source || s.source === source),
      ),
    [favorites],
  );

  const createPlaylist = useCallback(
    (name: string, initialSongs: Song[] = []) => {
      const newPlaylist: Playlist = {
        id: Date.now().toString(),
        name: String(name),
        createTime: Date.now(),
        songs: uniqueSongs(initialSongs.map(normalizeSong).filter((song): song is Song => Boolean(song))),
      };
      setPlaylistsState((prev) => [newPlaylist, ...prev]);
    },
    [],
  );

  const renamePlaylist = useCallback((id: string, name: string) => {
    if (id === "favorites") return;
    setPlaylistsState((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: String(name) } : p)),
    );
  }, []);

  const deletePlaylist = useCallback((id: string) => {
    if (id === "favorites") return;
    setPlaylistsState((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addToPlaylist = useCallback((playlistId: string, song: Song) => {
    const normalizedSong = normalizeSong(song);
    if (!normalizedSong) return;
    const songKey = getSongKey(normalizedSong);
    if (playlistId === "favorites") {
      const alreadyFavorite = favoritesRef.current.some((s) => getSongKey(s) === songKey);
      if (!alreadyFavorite) {
        void logRecommendationEvent({
          eventType: "favorite_add",
          song: normalizedSong,
          context: "library",
        }).catch(() => {});
      }
      setFavorites((prev) => {
        if (prev.find((s) => getSongKey(s) === songKey)) return prev;
        return [normalizedSong, ...prev];
      });
      return;
    }
    const targetPlaylist = playlistsRef.current.find((playlist) => playlist.id === playlistId);
    const alreadyInPlaylist = targetPlaylist?.songs.some((item) => getSongKey(item) === songKey);
    if (!alreadyInPlaylist) {
      void logRecommendationEvent({
        eventType: "playlist_add",
        song: normalizedSong,
        context: `playlist:${playlistId}`,
      }).catch(() => {});
    }
    setPlaylistsState((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        if (p.songs.find((s) => getSongKey(s) === songKey)) return p;
        return { ...p, songs: [...p.songs, normalizedSong] };
      }),
    );
  }, [setFavorites]);

  const removeFromPlaylist = useCallback(
    (playlistId: string, songId: number | string, source?: string) => {
      if (playlistId === "favorites") {
        setFavorites((prev) =>
          prev.filter(
            (s) => !(String(s.id) === String(songId) && (!source || s.source === source)),
          ),
        );
        return;
      }
      setPlaylistsState((prev) =>
        prev.map((p) => {
          if (p.id !== playlistId) return p;
          return {
            ...p,
            songs: p.songs.filter(
              (s) => !(String(s.id) === String(songId) && (!source || s.source === source)),
            ),
          };
        }),
      );
    },
    [setFavorites],
  );

  const exportData = useCallback((): LibraryExportResult => {
    return exportLibraryData(favoritesRef.current, playlistsRef.current);
  }, []);

  const parseImportData = useCallback(parseLibraryImport, []);

  const applyImportData = useCallback(
    (data: LibraryImportPreview, mode: LibraryImportMode = "replace"): LibraryApplyImportResult => {
      const favoritesToApply = normalizeSongArray(data.favorites);
      const playlistsToApply = normalizePlaylistArray(data.playlists);
      if (!favoritesToApply || !playlistsToApply) {
        return { ok: false, error: "导入数据结构不正确，未修改现有数据" };
      }

      const backup = {
        favorites: favoritesRef.current,
        playlists: playlistsRef.current,
      };

      if (mode === "merge") {
        setFavorites((prev) => mergeSongLists(prev, favoritesToApply));
        setPlaylistsState((prev) => mergePlaylists(prev, playlistsToApply));
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

  const importData = useCallback(
    (jsonData: string): boolean => {
      const parsed = parseImportData(jsonData);
      if (!parsed.ok) return false;
      return applyImportData(parsed.data, "replace").ok;
    },
    [applyImportData, parseImportData],
  );

  const value = useMemo<LibraryContextValue>(() => ({
    favorites,
    playlists,
    corsProxy,
    setCorsProxy,
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
  }), [
    favorites,
    playlists,
    corsProxy,
    setCorsProxy,
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
  ]);

  return (
    <LibraryContext.Provider value={value}>
      {children}
    </LibraryContext.Provider>
  );
};
