import {
  FAVORITES_KEY, PLAYLISTS_KEY, getStoredJson, isRecord,
  normalizePlaylistArray, normalizeSongArray, removeStoredValue, setStoredValue,
  type LibraryBackup,
} from './libraryData';
import { stripRuntimeSongFields } from '../services/songStorage';

export const LIBRARY_KEY = 'tunefree_library';
export const LIBRARY_SAVE_ERROR = '曲库保存失败，请检查可用存储空间；本次更改未生效';

export const loadLibrary = (): LibraryBackup => {
  const snapshot = getStoredJson<LibraryBackup | null>(LIBRARY_KEY, null, (value) => {
    if (!isRecord(value)) return null;
    const favorites = normalizeSongArray(value.favorites);
    const playlists = normalizePlaylistArray(value.playlists);
    return favorites && playlists ? { favorites, playlists } : null;
  });
  return snapshot ?? {
    favorites: getStoredJson(FAVORITES_KEY, [], normalizeSongArray),
    playlists: getStoredJson(PLAYLISTS_KEY, [], normalizePlaylistArray),
  };
};

export const persistLibrary = (snapshot: LibraryBackup): boolean => {
  try {
    const payload = {
      version: 1,
      favorites: snapshot.favorites.map(stripRuntimeSongFields),
      playlists: snapshot.playlists.map((playlist) => ({
        ...playlist, songs: playlist.songs.map(stripRuntimeSongFields),
      })),
    };
    // localStorage 单键写入是原子的，配额不足时不会留下半份曲库。
    if (!setStoredValue(LIBRARY_KEY, JSON.stringify(payload))) return false;
    removeStoredValue(FAVORITES_KEY);
    removeStoredValue(PLAYLISTS_KEY);
    return true;
  } catch (error) {
    console.warn('序列化曲库失败', error);
    return false;
  }
};
