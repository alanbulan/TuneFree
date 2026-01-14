import React, { createContext, useContext, useState, useEffect } from 'react';
import { Song, Playlist } from '../types';

interface LibraryContextType {
  favorites: Song[];
  playlists: Playlist[];
  toggleFavorite: (song: Song) => void;
  isFavorite: (songId: number) => boolean;
  createPlaylist: (name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (playlistId: string, song: Song) => void;
  removeFromPlaylist: (playlistId: string, songId: number) => void;
  exportData: () => void;
  importData: (jsonData: string) => boolean;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [favorites, setFavorites] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  // Load from local storage on mount
  useEffect(() => {
    const storedFavs = localStorage.getItem('tunefree_favorites');
    const storedPlaylists = localStorage.getItem('tunefree_playlists');
    if (storedFavs) setFavorites(JSON.parse(storedFavs));
    if (storedPlaylists) setPlaylists(JSON.parse(storedPlaylists));
  }, []);

  // Save to local storage whenever changed
  useEffect(() => {
    localStorage.setItem('tunefree_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('tunefree_playlists', JSON.stringify(playlists));
  }, [playlists]);

  const toggleFavorite = (song: Song) => {
    setFavorites(prev => {
      // Ensure strict type comparison for ID
      if (prev.find(s => String(s.id) === String(song.id))) {
        return prev.filter(s => String(s.id) !== String(song.id));
      }
      return [song, ...prev];
    });
  };

  const isFavorite = (songId: number | string) => {
    return favorites.some(s => String(s.id) === String(songId));
  };

  const createPlaylist = (name: string) => {
    const newPlaylist: Playlist = {
      id: Date.now().toString(),
      name,
      createTime: Date.now(),
      songs: []
    };
    setPlaylists(prev => [newPlaylist, ...prev]);
  };

  const deletePlaylist = (id: string) => {
    setPlaylists(prev => prev.filter(p => p.id !== id));
  };

  const addToPlaylist = (playlistId: string, song: Song) => {
    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        if (p.songs.find(s => String(s.id) === String(song.id))) return p; // prevent duplicates
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
      version: 2,
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
      console.error("Import failed", e);
      return false;
    }
  };

  return (
    <LibraryContext.Provider value={{
      favorites,
      playlists,
      toggleFavorite,
      isFavorite,
      createPlaylist,
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
  if (!context) {
    throw new Error('useLibrary must be used within a LibraryProvider');
  }
  return context;
};