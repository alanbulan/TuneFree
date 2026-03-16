import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Song, Playlist, getSongKey } from "../types";
import { DEFAULT_API_BASE } from "../services/api";

interface LibraryContextType {
  favorites: Song[];
  playlists: Playlist[];
  apiKey: string;
  corsProxy: string;
  apiBase: string;
  setApiKey: (key: string) => void;
  setCorsProxy: (url: string) => void;
  setApiBase: (url: string) => void;
  toggleFavorite: (song: Song) => void;
  isFavorite: (songId: number | string, source?: string) => boolean;
  createPlaylist: (name: string, initialSongs?: Song[]) => void;
  importPlaylist: (name: string, songs: Song[]) => void;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (playlistId: string, song: Song) => void;
  removeFromPlaylist: (playlistId: string, songId: number | string) => void;
  exportData: () => void;
  importData: (jsonData: string) => boolean;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

// 默认代理为空字符串，避免保存设置时把 corsproxy.io 写入 localStorage
// 从而覆盖 api.ts 中的自建代理优先逻辑（getProxies() 会在空值时回退到自建代理）
const DEFAULT_PROXY = "";

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [favorites, setFavorites] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [apiKey, setApiKeyInternal] = useState<string>(
    () => localStorage.getItem("tunefree_api_key") || "",
  );
  const [corsProxy, setCorsProxyInternal] = useState<string>(
    () => localStorage.getItem("tunefree_cors_proxy") || DEFAULT_PROXY,
  );
  const [apiBase, setApiBaseInternal] = useState<string>(
    () => localStorage.getItem("tunefree_api_base") || DEFAULT_API_BASE,
  );

  // Refs 用于 exportData，使其引用始终稳定（不随 favorites/playlists 变化重建）
  const favoritesRef = useRef(favorites);
  const playlistsRef = useRef(playlists);
  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);
  useEffect(() => {
    playlistsRef.current = playlists;
  }, [playlists]);

  // 初始化：从 localStorage 加载数据
  useEffect(() => {
    try {
      const storedFavs = localStorage.getItem("tunefree_favorites");
      const storedPlaylists = localStorage.getItem("tunefree_playlists");
      if (storedFavs) setFavorites(JSON.parse(storedFavs));
      if (storedPlaylists) setPlaylists(JSON.parse(storedPlaylists));
    } catch {
      // 数据损坏时静默忽略，使用默认空数据
    }
  }, []);

  // 持久化
  useEffect(() => {
    localStorage.setItem("tunefree_favorites", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem("tunefree_playlists", JSON.stringify(playlists));
  }, [playlists]);

  // ==============================
  // 设置项
  // ==============================

  const setApiKey = useCallback((key: string) => {
    setApiKeyInternal(key);
    localStorage.setItem("tunefree_api_key", key);
  }, []);

  const setCorsProxy = useCallback((url: string) => {
    setCorsProxyInternal(url);
    localStorage.setItem("tunefree_cors_proxy", url);
  }, []);

  const setApiBase = useCallback((url: string) => {
    // 移除末尾斜杠
    const cleanUrl = url.endsWith("/") ? url.slice(0, -1) : url;
    setApiBaseInternal(cleanUrl);
    localStorage.setItem("tunefree_api_base", cleanUrl);
  }, []);

  // ==============================
  // 收藏
  // ==============================

  const toggleFavorite = useCallback((song: Song) => {
    setFavorites((prev) => {
      const songKey = getSongKey(song);
      if (prev.find((s) => getSongKey(s) === songKey)) {
        return prev.filter((s) => getSongKey(s) !== songKey);
      }
      return [song, ...prev];
    });
  }, []);

  /**
   * isFavorite 读取 favorites 状态，需要跟随其变化，所以依赖 favorites。
   * 由于只在用户交互（收藏按钮）和渲染时调用，dep 随 favorites 变化可接受。
   */
  const isFavorite = useCallback(
    (songId: number | string, source?: string) =>
      favorites.some(
        (s) =>
          String(s.id) === String(songId) && (!source || s.source === source),
      ),
    [favorites],
  );

  // ==============================
  // 歌单
  // ==============================

  const createPlaylist = useCallback(
    (name: string, initialSongs: Song[] = []) => {
      const newPlaylist: Playlist = {
        id: Date.now().toString(),
        name: String(name),
        createTime: Date.now(),
        songs: initialSongs,
      };
      setPlaylists((prev) => [newPlaylist, ...prev]);
    },
    [],
  );

  const importPlaylist = useCallback((name: string, songs: Song[]) => {
    const newPlaylist: Playlist = {
      id: Date.now().toString(),
      name: String(name),
      createTime: Date.now(),
      songs,
    };
    setPlaylists((prev) => [newPlaylist, ...prev]);
  }, []);

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
        const songKey = getSongKey(song);
        if (p.songs.find((s) => getSongKey(s) === songKey)) return p;
        return { ...p, songs: [...p.songs, song] };
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

  // ==============================
  // 数据导入 / 导出
  // ==============================

  /**
   * exportData 使用 favoritesRef / playlistsRef 避免闭包陈旧，
   * 引用永久稳定，不会因 favorites/playlists 变化重建。
   */
  const exportData = useCallback(() => {
    const data = {
      version: 4,
      favorites: favoritesRef.current,
      playlists: playlistsRef.current,
      exportDate: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tunefree_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const importData = useCallback((jsonData: string): boolean => {
    try {
      const data = JSON.parse(jsonData);
      if (data.favorites) setFavorites(data.favorites);
      if (data.playlists) setPlaylists(data.playlists);
      return true;
    } catch {
      return false;
    }
  }, []);

  return (
    <LibraryContext.Provider
      value={{
        favorites,
        playlists,
        apiKey,
        corsProxy,
        apiBase,
        setApiKey,
        setCorsProxy,
        setApiBase,
        toggleFavorite,
        isFavorite,
        createPlaylist,
        importPlaylist,
        renamePlaylist,
        deletePlaylist,
        addToPlaylist,
        removeFromPlaylist,
        exportData,
        importData,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
};

// HMR 热更新时 Provider 可能暂时不可用，返回安全默认值避免崩溃
const LIBRARY_DEFAULTS: LibraryContextType = {
  favorites: [],
  playlists: [],
  apiKey: "",
  corsProxy: "",
  apiBase: DEFAULT_API_BASE,
  setApiKey: () => {},
  setCorsProxy: () => {},
  setApiBase: () => {},
  toggleFavorite: () => {},
  isFavorite: () => false,
  createPlaylist: () => {},
  importPlaylist: () => {},
  renamePlaylist: () => {},
  deletePlaylist: () => {},
  addToPlaylist: () => {},
  removeFromPlaylist: () => {},
  exportData: () => {},
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
