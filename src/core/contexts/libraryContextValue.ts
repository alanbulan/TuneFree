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

const useLibrarySlice = <T,>(
  context: Context<T | undefined>,
  hookName: string,
): T => {
  const value = useContext(context);
  if (value) return value;
  throw new Error(`${hookName} 必须在 LibraryProvider 内使用`);
};

export const useLibraryData = (): LibraryData =>
  useLibrarySlice(LibraryDataContext, 'useLibraryData');

export const useLibraryActions = (): LibraryActions =>
  useLibrarySlice(LibraryActionsContext, 'useLibraryActions');

export const useLibraryProxy = (): LibraryProxy =>
  useLibrarySlice(LibraryProxyContext, 'useLibraryProxy');

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
