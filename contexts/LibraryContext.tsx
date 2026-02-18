import React, { createContext, useContext, useState, useEffect } from 'react';
import { Song, Playlist } from '../types';
import { DEFAULT_API_BASE } from '../services/api';

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
  isFavorite: (songId: number | string) => boolean;
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

// 默认代理列表：corsproxy.io (推荐), allorigins (备选)
const DEFAULT_PROXY = 'https://corsproxy.io/?';

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [favorites, setFavorites] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [apiKey, setApiKeyInternal] = useState<string>(() => localStorage.getItem('tunefree_api_key') || '');
  const [corsProxy, setCorsProxyInternal] = useState<string>(() => localStorage.getItem('tunefree_cors_proxy') || DEFAULT_PROXY);
  const [apiBase, setApiBaseInternal] = useState<string>(() => localStorage.getItem('tunefree_api_base') || DEFAULT_API_BASE);

  useEffect(() => {
    const storedFavs = localStorage.getItem('tunefree_favorites');
    const storedPlaylists = localStorage.getItem('tunefree_playlists');
    if (storedFavs) setFavorites(JSON.parse(storedFavs));
    if (storedPlaylists) setPlaylists(JSON.parse(storedPlaylists));
  }, []);

  const setApiKey = (key: string) => {
    setApiKeyInternal(key);
    localStorage.setItem('tunefree_api_key', key);
  };

  const setCorsProxy = (url: string) => {
    setCorsProxyInternal(url);
    localStorage.setItem('tunefree_cors_proxy', url);
  };

  const setApiBase = (url: string) => {
    // 移除末尾斜杠
    const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    setApiBaseInternal(cleanUrl);
    localStorage.setItem('tunefree_api_base', cleanUrl);
  };

  useEffect(() => {
    localStorage.setItem('tunefree_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('tunefree_playlists', JSON.stringify(playlists));
  }, [playlists]);

  const toggleFavorite = (song: Song) => {
    setFavorites(prev => {
      if (prev.find(s => String(s.id) === String(song.id))) {
        return prev.filter(s => String(s.id) !== String(song.id));
      }
      return [song, ...prev];
    });
  };

  const isFavorite = (songId: number | string) => {
    return favorites.some(s => String(s.id) === String(songId));
  };

  const createPlaylist = (name: string, initialSongs: Song[] = []) => {
    const newPlaylist: Playlist = {
      id: Date.now().toString(),
      name: String(name),
      createTime: Date.now(),
      songs: initialSongs
    };
    setPlaylists(prev => [newPlaylist, ...prev]);
  };

  const importPlaylist = (name: string, songs: Song[]) => {
    const newPlaylist: Playlist = {
      id: Date.now().toString(),
      name: String(name),
      createTime: Date.now(),
      songs
    };
    setPlaylists(prev => [newPlaylist, ...prev]);
  };

  const renamePlaylist = (id: string, name: string) => {
    setPlaylists(prev => prev.map(p => p.id === id ? { ...p, name: String(name) } : p));
  };

  const deletePlaylist = (id: string) => {
    setPlaylists(prev => prev.filter(p => p.id !== id));
  };

  const addToPlaylist = (playlistId: string, song: Song) => {
    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        if (p.songs.find(s => String(s.id) === String(song.id))) return p;
        return { ...p, songs: [...p.songs, song] };
      }
      return p;
    }));
  };

  const removeFromPlaylist = (playlistId: string, songId: number | string) => {
    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        return { ...p, songs: p.songs.filter(s => String(s.id) !== String(songId)) };
      }
      return p;
    }));
  };

  const exportData = () => {
    const data = {
      version: 4,
      favorites,
      playlists,
      exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tunefree_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (jsonData: string): boolean => {
    try {
      const data = JSON.parse(jsonData);
      if (data.favorites) setFavorites(data.favorites);
      if (data.playlists) setPlaylists(data.playlists);
      return true;
    } catch (e) {
      return false;
    }
  };

  return (
    <LibraryContext.Provider value={{
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
      importData
    }}>
      {children}
    </LibraryContext.Provider>
  );
};

export const useLibrary = () => {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useLibrary must be used within a LibraryProvider');
  return context;
};