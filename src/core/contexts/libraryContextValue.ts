import { createContext, useContext } from 'react';

import type { LibraryContextValue } from './libraryData';

export const LibraryContext = createContext<LibraryContextValue | undefined>(undefined);

const LIBRARY_DEFAULTS: LibraryContextValue = {
  favorites: [], playlists: [], corsProxy: '',
  setCorsProxy: () => {}, toggleFavorite: () => {}, isFavorite: () => false,
  createPlaylist: () => {}, renamePlaylist: () => {}, deletePlaylist: () => {},
  addToPlaylist: () => {}, removeFromPlaylist: () => {},
  exportData: () => ({ ok: false, error: 'Provider 未就绪' }),
  parseImportData: () => ({ ok: false, error: 'Provider 未就绪' }),
  applyImportData: () => ({ ok: false, error: 'Provider 未就绪' }),
  restoreData: () => {}, importData: () => false,
};

export const useLibrary = () => {
  const context = useContext(LibraryContext);
  if (context) return context;
  console.warn('[useLibrary] Provider 未就绪，返回默认值（HMR 热更新中）');
  return LIBRARY_DEFAULTS;
};
