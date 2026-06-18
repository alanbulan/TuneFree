'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  applyThemeClasses,
  applyThemeVariables,
  clampLyricSize,
  DEFAULT_THEME_PREFERENCES,
  normalizeThemeColor,
  normalizeThemeMode,
  readThemePreferences,
  resolveThemeIsDark,
  resolveThemeTokens,
  THEME_STORAGE_KEYS,
  type ThemeColor,
  type ThemeMode,
} from '../utils/theme';

export type { ThemeColor, ThemeMode } from '../utils/theme';

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  themeColor: ThemeColor;
  setThemeColor: (color: ThemeColor) => void;
  lyricSize: number;
  setLyricSize: (size: number) => void;
  lyricFont: string;
  setLyricFont: (font: string) => void;
  showDesktopLyric: boolean;
  setShowDesktopLyric: (show: boolean) => void;
  lockDesktopLyric: boolean;
  setLockDesktopLyric: (lock: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(DEFAULT_THEME_PREFERENCES.themeMode);
  const [themeColor, setThemeColorState] = useState<ThemeColor>(DEFAULT_THEME_PREFERENCES.themeColor);
  const [lyricSize, setLyricSizeState] = useState<number>(DEFAULT_THEME_PREFERENCES.lyricSize);
  const [lyricFont, setLyricFontState] = useState<string>(DEFAULT_THEME_PREFERENCES.lyricFont);
  const [showDesktopLyric, setShowDesktopLyricState] = useState<boolean>(DEFAULT_THEME_PREFERENCES.showDesktopLyric);
  const [lockDesktopLyric, setLockDesktopLyricState] = useState<boolean>(DEFAULT_THEME_PREFERENCES.lockDesktopLyric);

  // 从 localStorage 加载配置，并对旧版本/异常值做安全兜底
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const preferences = readThemePreferences(localStorage);
    setThemeModeState(preferences.themeMode);
    setThemeColorState(preferences.themeColor);
    setLyricSizeState(preferences.lyricSize);
    setLyricFontState(preferences.lyricFont);
    setShowDesktopLyricState(preferences.showDesktopLyric);
    setLockDesktopLyricState(preferences.lockDesktopLyric);
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    const safeMode = normalizeThemeMode(mode);
    setThemeModeState(safeMode);
    localStorage.setItem(THEME_STORAGE_KEYS.mode, safeMode);
  };

  const setThemeColor = (color: ThemeColor) => {
    const safeColor = normalizeThemeColor(color);
    setThemeColorState(safeColor);
    localStorage.setItem(THEME_STORAGE_KEYS.color, safeColor);
  };

  const setLyricSize = (size: number) => {
    const safeSize = clampLyricSize(size);
    setLyricSizeState(safeSize);
    localStorage.setItem(THEME_STORAGE_KEYS.lyricSize, safeSize.toString());
  };

  const setLyricFont = (font: string) => {
    const safeFont = font || DEFAULT_THEME_PREFERENCES.lyricFont;
    setLyricFontState(safeFont);
    localStorage.setItem(THEME_STORAGE_KEYS.lyricFont, safeFont);
  };

  const setShowDesktopLyric = (show: boolean) => {
    setShowDesktopLyricState(show);
    localStorage.setItem(THEME_STORAGE_KEYS.showDesktopLyric, show ? 'true' : 'false');
  };

  const setLockDesktopLyric = (lock: boolean) => {
    setLockDesktopLyricState(lock);
    localStorage.setItem(THEME_STORAGE_KEYS.lockDesktopLyric, lock ? 'true' : 'false');
  };

  // 应用主题模式、主题色与歌词配置到全局 CSS 变量；system 模式跟随 OS 实时变化
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const htmlEl = document.documentElement;
    const applyTheme = () => {
      const isDark = resolveThemeIsDark(themeMode);
      const tokens = resolveThemeTokens(themeMode, themeColor, isDark);
      applyThemeClasses(htmlEl, isDark);
      applyThemeVariables(htmlEl, tokens, { lyricSize, lyricFont });
    };

    applyTheme();

    if (themeMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [themeMode, themeColor, lyricSize, lyricFont]);

  // 跨窗口同步 Tauri 歌词窗口的显示与隐藏
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    if (!isTauri) return;

    let active = true;

    const manageWindow = async () => {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const lyricWindow = await WebviewWindow.getByLabel('desktop-lyric');

        if (active && lyricWindow) {
          if (showDesktopLyric) {
            await lyricWindow.show();
            // 应用穿透属性
            await lyricWindow.setIgnoreCursorEvents(lockDesktopLyric);
          } else {
            await lyricWindow.hide();
          }
        }
      } catch (err) {
        console.error('Tauri window management failed:', err);
      }
    };

    manageWindow();

    return () => {
      active = false;
    };
  }, [showDesktopLyric, lockDesktopLyric]);

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        setThemeMode,
        themeColor,
        setThemeColor,
        lyricSize,
        setLyricSize,
        lyricFont,
        setLyricFont,
        showDesktopLyric,
        setShowDesktopLyric,
        lockDesktopLyric,
        setLockDesktopLyric,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
