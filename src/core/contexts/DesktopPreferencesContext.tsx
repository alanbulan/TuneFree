'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type CloseBehavior = 'ask' | 'tray' | 'exit';

const CLOSE_BEHAVIOR_STORAGE_KEY = 'tunefree_close_behavior';
const DEFAULT_CLOSE_BEHAVIOR: CloseBehavior = 'ask';

const normalizeCloseBehavior = (value: unknown): CloseBehavior => {
  if (value === 'ask' || value === 'tray' || value === 'exit') return value;
  return DEFAULT_CLOSE_BEHAVIOR;
};

interface DesktopPreferencesContextType {
  closeBehavior: CloseBehavior;
  setCloseBehavior: (behavior: CloseBehavior) => void;
}

const DesktopPreferencesContext = createContext<DesktopPreferencesContextType | undefined>(undefined);

export const DesktopPreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [closeBehavior, setCloseBehaviorState] = useState<CloseBehavior>(() =>
    typeof window === 'undefined' ? DEFAULT_CLOSE_BEHAVIOR
      : normalizeCloseBehavior(localStorage.getItem(CLOSE_BEHAVIOR_STORAGE_KEY)));

  const setCloseBehavior = useCallback((behavior: CloseBehavior) => {
    const normalized = normalizeCloseBehavior(behavior);
    setCloseBehaviorState(normalized);
    if (typeof window !== 'undefined') {
      localStorage.setItem(CLOSE_BEHAVIOR_STORAGE_KEY, normalized);
    }
  }, []);

  const value = useMemo(
    () => ({ closeBehavior, setCloseBehavior }), [closeBehavior, setCloseBehavior],
  );

  return (
    <DesktopPreferencesContext.Provider value={value}>
      {children}
    </DesktopPreferencesContext.Provider>
  );
};

export const useDesktopPreferences = () => {
  const context = useContext(DesktopPreferencesContext);
  if (!context) {
    throw new Error('useDesktopPreferences must be used within DesktopPreferencesProvider');
  }
  return context;
};
