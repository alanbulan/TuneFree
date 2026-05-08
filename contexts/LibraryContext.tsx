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
  favorites: Song[];
  playlists: Playlist[];
  favoriteCount: number;
  playlistCount: number;
  playlistSongCount: number;
  backup: LibraryBackup;
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
    mode: LibraryImportMode,
  ) => LibraryApplyImportResult;
  restoreData: (backup: LibraryBackup) => void;
  importData: (jsonData: string) => boolean;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);
const DEFAULT_PROXY = "";
const FAVORITES_KEY = "tunefree_favorites";
const PLAYLISTS_KEY = "tunefree_playlists";
const CORS_PROXY_KEY = "tunefree_cors_proxy";

type StoredValue<T> = {
  value: T;
  corrupt: boolean;
};

const asString = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const normalizeSong = (value: unknown): Song | null => {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<Song>;
  if (input.id === undefined || input.id === null) return null;
  if (typeof input.source !== "string" || !input.source.trim()) return null;

  const song: Song = {
    id: input.id,
    source: input.source,
    name: asString(input.name, "未知歌曲"),
    artist: asString(input.artist, "未知歌手"),
    album: asString(input.album, "未知专辑"),
  };

  if (typeof input.pic === "string") song.pic = input.pic;
  if (typeof input.picId === "string") song.picId = input.picId;
  if (typeof input.url === "string") song.url = input.url;
  if (typeof input.urlId === "string") song.urlId = input.urlId;
  if (typeof input.lrc === "string") song.lrc = input.lrc;
  if (typeof input.lyricId === "string") song.lyricId = input.lyricId;
  if (Array.isArray(input.types)) {
    song.types = input.types.filter((type): type is string => typeof type === "string");
  }

  return song;
};

const uniqueSongs = (songs: Song[]) => {
  const seen = new Set<string>();
  const result: Song[] = [];
  songs.forEach((song) => {
    const key = getSongKey(song);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(song);
  });
  return result;
};

const normalizeSongArray = (value: unknown): Song[] => {
  if (!Array.isArray(value)) return [];
  return uniqueSongs(value.map(normalizeSong).filter((song): song is Song => Boolean(song)));
};

const normalizePlaylist = (value: unknown): Playlist | null => {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<Playlist>;
  if (typeof input.id !== "string" || !input.id.trim()) return null;
  if (!Array.isArray(input.songs)) return null;

  return {
    id: input.id,
    name: asString(input.name, "未命名歌单"),
    createTime: typeof input.createTime === "number" ? input.createTime : Date.now(),
    songs: normalizeSongArray(input.songs),
  };
};

const normalizePlaylistArray = (value: unknown): Playlist[] => {
  if (!Array.isArray(value)) return [];
  const playlists = value
    .map(normalizePlaylist)
    .filter((playlist): playlist is Playlist => Boolean(playlist));
  const seen = new Set<string>();
  return playlists.filter((playlist) => {
    if (seen.has(playlist.id)) return false;
    seen.add(playlist.id);
    return true;
  });
};

const backupCorruptStorage = (key: string, rawValue: string) => {
  try {
    localStorage.setItem(`${key}_corrupt_${Date.now()}`, rawValue);
  } catch {
    return;
  }
};

const getStoredJson = <T,>(
  key: string,
  fallback: T,
  normalize: (value: unknown) => T,
): StoredValue<T> => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { value: fallback, corrupt: false };
    return { value: normalize(JSON.parse(raw)), corrupt: false };
  } catch {
    const raw = localStorage.getItem(key);
    if (raw) backupCorruptStorage(key, raw);
    return { value: fallback, corrupt: true };
  }
};

const mergeSongs = (incoming: Song[], current: Song[]) => uniqueSongs([...incoming, ...current]);

const mergePlaylists = (incoming: Playlist[], current: Playlist[]) => {
  const map = new Map(current.map((playlist) => [playlist.id, playlist]));
  incoming.forEach((playlist) => {
    const existing = map.get(playlist.id);
    map.set(
      playlist.id,
      existing
        ? { ...existing, ...playlist, songs: mergeSongs(playlist.songs, existing.songs) }
        : playlist,
    );
  });
  return Array.from(map.values()).sort((a, b) => b.createTime - a.createTime);
};

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const favoriteStorageRef = useRef<StoredValue<Song[]> | null>(null);
  const playlistStorageRef = useRef<StoredValue<Playlist[]> | null>(null);
  if (!favoriteStorageRef.current) {
    favoriteStorageRef.current = getStoredJson(FAVORITES_KEY, [] as Song[], normalizeSongArray);
  }
  if (!playlistStorageRef.current) {
    playlistStorageRef.current = getStoredJson(PLAYLISTS_KEY, [] as Playlist[], normalizePlaylistArray);
  }

  const [favorites, setFavorites] = useState<Song[]>(favoriteStorageRef.current.value);
  const [playlists, setPlaylists] = useState<Playlist[]>(playlistStorageRef.current.value);
  const [corsProxy, setCorsProxyInternal] = useState<string>(
    () => localStorage.getItem(CORS_PROXY_KEY) || DEFAULT_PROXY,
  );

  const favoritesRef = useRef(favorites);
  const playlistsRef = useRef(playlists);
  const firstFavoritePersistRef = useRef(true);
  const firstPlaylistPersistRef = useRef(true);

  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);

  useEffect(() => {
    playlistsRef.current = playlists;
  }, [playlists]);

  useEffect(() => {
    if (firstFavoritePersistRef.current) {
      firstFavoritePersistRef.current = false;
      if (favoriteStorageRef.current?.corrupt) return;
    }
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (firstPlaylistPersistRef.current) {
      firstPlaylistPersistRef.current = false;
      if (playlistStorageRef.current?.corrupt) return;
    }
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  }, [playlists]);

  const setCorsProxy = useCallback((url: string) => {
    setCorsProxyInternal(url);
    localStorage.setItem(CORS_PROXY_KEY, url);
  }, []);

  const toggleFavorite = useCallback((song: Song) => {
    setFavorites((prev) => {
      const normalized = normalizeSong(song);
      if (!normalized) return prev;
      const songKey = getSongKey(normalized);
      if (prev.find((s) => getSongKey(s) === songKey)) {
        return prev.filter((s) => getSongKey(s) !== songKey);
      }
      return [normalized, ...prev];
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
        songs: normalizeSongArray(initialSongs),
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
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        const normalized = normalizeSong(song);
        if (!normalized) return p;
        const songKey = getSongKey(normalized);
        if (p.songs.find((s) => getSongKey(s) === songKey)) return p;
        return { ...p, songs: [...p.songs, normalized] };
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
    try {
      const data = {
        version: 4,
        favorites: favoritesRef.current,
        playlists: playlistsRef.current,
        exportDate: new Date().toISOString(),
      };
      const filename = `tunefree_backup_${new Date().toISOString().slice(0, 10)}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return { ok: true, filename };
    } catch {
      return { ok: false, error: "导出失败，请稍后再试" };
    }
  }, []);

  const parseImportData = useCallback((jsonData: string): LibraryImportResult => {
    try {
      const parsed = JSON.parse(jsonData) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") {
        return { ok: false, error: "导入文件格式不正确" };
      }
      if (!Array.isArray(parsed.favorites) && !Array.isArray(parsed.playlists)) {
        return { ok: false, error: "不是 TuneFree 备份文件" };
      }

      const nextFavorites = normalizeSongArray(parsed.favorites);
      const nextPlaylists = normalizePlaylistArray(parsed.playlists);
      const playlistSongCount = nextPlaylists.reduce((total, playlist) => total + playlist.songs.length, 0);
      if (nextFavorites.length === 0 && nextPlaylists.length === 0) {
        return { ok: false, error: "没有可导入的有效数据" };
      }

      return {
        ok: true,
        data: {
          favorites: nextFavorites,
          playlists: nextPlaylists,
          favoriteCount: nextFavorites.length,
          playlistCount: nextPlaylists.length,
          playlistSongCount,
          backup: {
            favorites: favoritesRef.current,
            playlists: playlistsRef.current,
          },
        },
      };
    } catch {
      return { ok: false, error: "JSON 解析失败" };
    }
  }, []);

  const applyImportData = useCallback(
    (data: LibraryImportPreview, mode: LibraryImportMode): LibraryApplyImportResult => {
      try {
        const backup = {
          favorites: favoritesRef.current,
          playlists: playlistsRef.current,
        };
        if (mode === "merge") {
          setFavorites((prev) => mergeSongs(data.favorites, prev));
          setPlaylists((prev) => mergePlaylists(data.playlists, prev));
        } else {
          setFavorites(data.favorites);
          setPlaylists(data.playlists);
        }
        return { ok: true, backup };
      } catch {
        return { ok: false, error: "导入失败，请稍后再试" };
      }
    },
    [],
  );

  const restoreData = useCallback((backup: LibraryBackup) => {
    setFavorites(normalizeSongArray(backup.favorites));
    setPlaylists(normalizePlaylistArray(backup.playlists));
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
