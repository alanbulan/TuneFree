import React from "react";

import {
  LibraryActionsContext,
  LibraryDataContext,
  LibraryProxyContext,
} from './libraryContextValue';
import { useLibraryStore } from './useLibraryStore';

export {
  useLibrary,
  useLibraryActions,
  useLibraryData,
  useLibraryProxy,
} from './libraryContextValue';

export type {
  LibraryActions,
  LibraryApplyImportResult,
  LibraryBackup,
  LibraryContextValue,
  LibraryData,
  LibraryExportResult,
  LibraryImportMode,
  LibraryImportPreview,
  LibraryImportResult,
  LibraryProxy,
} from './libraryData';

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { actionsValue, dataValue, proxyValue } = useLibraryStore();
  return (
    <LibraryActionsContext.Provider value={actionsValue}>
      <LibraryProxyContext.Provider value={proxyValue}>
        <LibraryDataContext.Provider value={dataValue}>
          {children}
        </LibraryDataContext.Provider>
      </LibraryProxyContext.Provider>
    </LibraryActionsContext.Provider>
  );
};
