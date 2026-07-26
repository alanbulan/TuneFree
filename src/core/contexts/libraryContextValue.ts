import { createContext, useContext, useMemo, type Context } from 'react';

import type {
  LibraryActions,
  LibraryContextValue,
  LibraryData,
  LibraryProxy,
} from './libraryData';

export const LibraryDataContext = createContext<LibraryData | undefined>(undefined);
export const LibraryActionsContext = createContext<LibraryActions | undefined>(undefined);
export const LibraryProxyContext = createContext<LibraryProxy | undefined>(undefined);

const LIBRARY_DATA_DEFAULTS: LibraryData = {
  favorites: [], playlists: [], isFavorite: () => false,
};

const LIBRARY_ACTIONS_DEFAULTS: LibraryActions = {
  toggleFavorite: () => {},
  createPlaylist: () => {}, renamePlaylist: () => {}, deletePlaylist: () => {},
  addToPlaylist: () => {}, removeFromPlaylist: () => {},
  exportData: () => ({ ok: false, error: 'Provider 未就绪' }),
  parseImportData: () => ({ ok: false, error: 'Provider 未就绪' }),
  applyImportData: () => ({ ok: false, error: 'Provider 未就绪' }),
  restoreData: () => {}, importData: () => false,
};

const LIBRARY_PROXY_DEFAULTS: LibraryProxy = { corsProxy: '', setCorsProxy: () => {} };

const useLibrarySlice = <T,>(
  context: Context<T | undefined>,
  fallback: T,
  hookName: string,
): T => {
  const value = useContext(context);
  if (value) return value;
  console.warn(`[${hookName}] Provider 未就绪，返回默认值（HMR 热更新中）`);
  return fallback;
};

export const useLibraryData = (): LibraryData =>
  useLibrarySlice(LibraryDataContext, LIBRARY_DATA_DEFAULTS, 'useLibraryData');

export const useLibraryActions = (): LibraryActions =>
  useLibrarySlice(LibraryActionsContext, LIBRARY_ACTIONS_DEFAULTS, 'useLibraryActions');

export const useLibraryProxy = (): LibraryProxy =>
  useLibrarySlice(LibraryProxyContext, LIBRARY_PROXY_DEFAULTS, 'useLibraryProxy');

/**
 * Transitional aggregate hook. Subscribing to it re-renders on every library change, so prefer the
 * narrow `useLibraryData` / `useLibraryActions` / `useLibraryProxy` hooks in new code.
 */
export const useLibrary = (): LibraryContextValue => {
  const data = useLibraryData();
  const actions = useLibraryActions();
  const proxy = useLibraryProxy();
  return useMemo(() => ({ ...data, ...actions, ...proxy }), [actions, data, proxy]);
};
