import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Song, Playlist, getSongKey } from "../types";

export interface LibraryBackup {
  favorites: Song[];
  playlists: Playlist[];
}

export interface LibraryImportPreview {
  version?: number;
  favorites: Song[];
  playlists: Playlist[];
  favoriteCount: number;
  playlistCount: number;
  playlistSongCount: number;
}

export type LibraryImportMode = "replace" | "merge";

export type LibraryImportResult =
  | { ok: true; data: LibraryImportPreview }
  | { ok: false; error: string };

export type LibraryExportResult =
  | { ok: true; filename: string }
  | { ok: false; error: string };

export type LibraryApplyImportResult =
  | { ok: true; backup: LibraryBackup }
  | { ok: false; error: string };

interface LibraryContextType {
  favorites: Song[];
  playlists: Playlist[];
  corsProxy: string;
  setCorsProxy: (url: string) => void;
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
    mode?: LibraryImportMode,
  ) => LibraryApplyImportResult;
  restoreData: (backup: LibraryBackup) => void;
  importData: (jsonData: string) => boolean;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

const DEFAULT_PROXY = "";
const FAVORITES_KEY = "tunefree_favorites";
const PLAYLISTS_KEY = "tunefree_playlists";
const CORS_PROXY_KEY = "tunefree_cors_proxy";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const normalizeSong = (value: unknown): Song | null => {
  if (!isRecord(value)) return null;
  const id = value.id;
  const source = value.source;
  if ((typeof id !== "string" && typeof id !== "number") || typeof source !== "string" || !source) {
    return null;
  }

  const song: Song = {
    ...(value as Record<string, unknown>),
    id,
    source,
    name: getString(value.name, "未知歌曲"),
    artist: getString(value.artist, "未知歌手"),
    album: getString(value.album, "未知专辑"),
  } as Song;

  for (const key of ["pic", "picId", "url", "urlId", "lrc", "lyricId"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      delete song[key];
    }
  }
  if (value.types !== undefined && !Array.isArray(value.types)) delete song.types;
  return song;
};

const uniqueSongs = (songs: Song[]) => {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = getSongKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeSongArray = (value: unknown): Song[] | null => {
  if (!Array.isArray(value)) return null;
  return uniqueSongs(value.map(normalizeSong).filter((song): song is Song => Boolean(song)));
};

const normalizePlaylist = (value: unknown): Playlist | null => {
  if (!isRecord(value)) return null;
  const id = value.id;
  const songs = normalizeSongArray(value.songs);
  if (typeof id !== "string" || !id || typeof value.name !== "string" || !songs) return null;

  const createTime =
    typeof value.createTime === "number" && Number.isFinite(value.createTime)
      ? value.createTime
      : Date.now();

  return {
    id,
    name: value.name,
    createTime,
    songs,
  };
};

const normalizePlaylistArray = (value: unknown): Playlist[] | null => {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  return value
    .map(normalizePlaylist)
    .filter((playlist): playlist is Playlist => Boolean(playlist))
    .filter((playlist) => {
      if (seen.has(playlist.id)) return false;
      seen.add(playlist.id);
      return true;
    });
};

const backupCorruptStorage = (key: string, rawValue: string) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${key}_corrupt_${Date.now()}`, rawValue);
  } catch {
    /* ignore */
  }
};

const getStoredValue = (key: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) || fallback;
};
const setStoredValue = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, value);
};
const getStoredJson = <T,>(
  key: string,
  fallback: T,
  normalize: (value: unknown) => T | null,
): T => {
  if (typeof window === "undefined") return fallback;
  const rawValue = localStorage.getItem(key);
  if (!rawValue) return fallback;
  try {
    const normalized = normalize(JSON.parse(rawValue));
    if (normalized) return normalized;
    backupCorruptStorage(key, rawValue);
    return fallback;
  } catch {
    backupCorruptStorage(key, rawValue);
    return fallback;
  }
};

const mergeSongLists = (base: Song[], incoming: Song[]) => uniqueSongs([...base, ...incoming]);

const mergePlaylists = (base: Playlist[], incoming: Playlist[]) => {
  const byId = new Map<string, Playlist>();
  base.forEach((playlist) => byId.set(playlist.id, playlist));
  incoming.forEach((playlist) => {
    const existing = byId.get(playlist.id);
    if (!existing) {
      byId.set(playlist.id, playlist);
      return;
    }
    byId.set(playlist.id, {
      ...existing,
      songs: mergeSongLists(existing.songs, playlist.songs),
    });
  });
  return Array.from(byId.values());
};

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [favorites, setFavorites] = useState<Song[]>(() =>
    getStoredJson<Song[]>(FAVORITES_KEY, [], normalizeSongArray),
  );
  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    getStoredJson<Playlist[]>(PLAYLISTS_KEY, [], normalizePlaylistArray),
  );
  const [corsProxy, setCorsProxyInternal] = useState<string>(
    () => getStoredValue(CORS_PROXY_KEY, DEFAULT_PROXY),
  );

  const favoritesRef = useRef(favorites);
  const playlistsRef = useRef(playlists);
  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);
  useEffect(() => {
    playlistsRef.current = playlists;
  }, [playlists]);

  useEffect(() => {
    setStoredValue(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    setStoredValue(PLAYLISTS_KEY, JSON.stringify(playlists));
  }, [playlists]);

  const setCorsProxy = useCallback((url: string) => {
    setCorsProxyInternal(url);
    setStoredValue(CORS_PROXY_KEY, url);
  }, []);

  const toggleFavorite = useCallback((song: Song) => {
    setFavorites((prev) => {
      const normalizedSong = normalizeSong(song);
      if (!normalizedSong) return prev;
      const songKey = getSongKey(normalizedSong);
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
      setPlaylists((prev) => [newPlaylist, ...prev]);
    },
    [],
  );

  const renamePlaylist = useCallback((id: string, name: string) => {
    setPlaylists((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: String(name) } : p)),
    );
  }, []);

  const deletePlaylist = useCallback((id: string) => {
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addToPlaylist = useCallback((playlistId: string, song: Song) => {
    const normalizedSong = normalizeSong(song);
    if (!normalizedSong) return;
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        const songKey = getSongKey(normalizedSong);
        if (p.songs.find((s) => getSongKey(s) === songKey)) return p;
        return { ...p, songs: [...p.songs, normalizedSong] };
      }),
    );
  }, []);

  const removeFromPlaylist = useCallback(
    (playlistId: string, songId: number | string, source?: string) => {
      setPlaylists((prev) =>
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
    [],
  );

  const exportData = useCallback((): LibraryExportResult => {
    if (typeof document === "undefined") return { ok: false, error: "当前环境不支持导出" };
    let url = "";
    const filename = `tunefree_backup_${new Date().toISOString().slice(0, 10)}.json`;
    try {
      const data = {
        version: 4,
        favorites: favoritesRef.current,
        playlists: playlistsRef.current,
        exportDate: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      return { ok: true, filename };
    } catch {
      return { ok: false, error: "导出失败，请稍后再试" };
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }, []);

  const parseImportData = useCallback((jsonData: string): LibraryImportResult => {
    try {
      const data = JSON.parse(jsonData);
      if (!isRecord(data)) return { ok: false, error: "导入文件不是有效的 TuneFree JSON" };
      if (!("favorites" in data) && !("playlists" in data)) {
        return { ok: false, error: "导入文件缺少收藏或歌单数据" };
      }

      const favorites = "favorites" in data ? normalizeSongArray(data.favorites) : [];
      const playlists = "playlists" in data ? normalizePlaylistArray(data.playlists) : [];
      if (!favorites || !playlists) return { ok: false, error: "导入文件结构不正确，未修改现有数据" };

      return {
        ok: true,
        data: {
          version: typeof data.version === "number" ? data.version : undefined,
          favorites,
          playlists,
          favoriteCount: favorites.length,
          playlistCount: playlists.length,
          playlistSongCount: playlists.reduce((total, playlist) => total + playlist.songs.length, 0),
        },
      };
    } catch {
      return { ok: false, error: "JSON 解析失败，未修改现有数据" };
    }
  }, []);

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
        setPlaylists((prev) => mergePlaylists(prev, playlistsToApply));
      } else {
        setFavorites(favoritesToApply);
        setPlaylists(playlistsToApply);
      }

      return { ok: true, backup };
    },
    [],
  );

  const restoreData = useCallback((backup: LibraryBackup) => {
    setFavorites(backup.favorites);
    setPlaylists(backup.playlists);
  }, []);

  const importData = useCallback(
    (jsonData: string): boolean => {
      const parsed = parseImportData(jsonData);
      if (!parsed.ok) return false;
      return applyImportData(parsed.data, "replace").ok;
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
  toggleFavorite: () => {},
  isFavorite: () => false,
  createPlaylist: () => {},
  renamePlaylist: () => {},
  deletePlaylist: () => {},
  addToPlaylist: () => {},
  removeFromPlaylist: () => {},
  exportData: () => ({ ok: false, error: "Provider 未就绪" }),
  parseImportData: () => ({ ok: false, error: "Provider 未就绪" }),
  applyImportData: () => ({ ok: false, error: "Provider 未就绪" }),
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
