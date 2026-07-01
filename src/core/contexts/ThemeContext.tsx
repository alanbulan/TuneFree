'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

  const setThemeMode = useCallback((mode: ThemeMode) => {
    const safeMode = normalizeThemeMode(mode);
    setThemeModeState(safeMode);
    localStorage.setItem(THEME_STORAGE_KEYS.mode, safeMode);
  }, []);

  const setThemeColor = useCallback((color: ThemeColor) => {
    const safeColor = normalizeThemeColor(color);
    setThemeColorState(safeColor);
    localStorage.setItem(THEME_STORAGE_KEYS.color, safeColor);
  }, []);

  const setLyricSize = useCallback((size: number) => {
    const safeSize = clampLyricSize(size);
    setLyricSizeState(safeSize);
    localStorage.setItem(THEME_STORAGE_KEYS.lyricSize, safeSize.toString());
  }, []);

  const setLyricFont = useCallback((font: string) => {
    const safeFont = font || DEFAULT_THEME_PREFERENCES.lyricFont;
    setLyricFontState(safeFont);
    localStorage.setItem(THEME_STORAGE_KEYS.lyricFont, safeFont);
  }, []);

  const setShowDesktopLyric = useCallback((show: boolean) => {
    setShowDesktopLyricState(show);
    localStorage.setItem(THEME_STORAGE_KEYS.showDesktopLyric, show ? 'true' : 'false');
  }, []);

  const setLockDesktopLyric = useCallback((lock: boolean) => {
    setLockDesktopLyricState(lock);
    localStorage.setItem(THEME_STORAGE_KEYS.lockDesktopLyric, lock ? 'true' : 'false');
  }, []);

  // 应用主题模式、主题色与歌词配置到全局 CSS 变量；system 模式跟随 OS 实时变化
  // 使用 View Transitions API 实现浅色/深色切换时的平滑过渡，避免闪烁
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const htmlEl = document.documentElement;
    const applyTheme = () => {
      const isDark = resolveThemeIsDark(themeMode);
      const tokens = resolveThemeTokens(themeMode, themeColor, isDark);

      const runSwitch = () => {
        applyThemeClasses(htmlEl, isDark);
        applyThemeVariables(htmlEl, tokens, { lyricSize, lyricFont });
      };

      // View Transitions API: cross-fade old → new snapshot, eliminates the flicker
      const vt = (document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } });
      if (typeof vt.startViewTransition === 'function') {
        // Skip transition if class is already correct (e.g. first mount)
        const alreadyDark = htmlEl.classList.contains('dark-theme') === isDark;
        if (alreadyDark) {
          runSwitch();
        } else {
          const transition = vt.startViewTransition(runSwitch);
          transition.finished.catch(() => {});
        }
      } else {
        runSwitch();
      }
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

  const value = useMemo<ThemeContextType>(() => ({
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
  }), [
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
  ]);

  const styleContent = useMemo(() => {
    const isDark = resolveThemeIsDark(themeMode);
    const tokens = resolveThemeTokens(themeMode, themeColor, isDark);
    const size = clampLyricSize(lyricSize);
    const font = lyricFont || DEFAULT_THEME_PREFERENCES.lyricFont;
    return `
      html, :root {
        --accent: ${tokens.accent} !important;
        --play: ${tokens.play} !important;
        --danger: ${tokens.danger} !important;
        --accent-rgb: ${tokens.accentRgb} !important;
        --danger-rgb: ${tokens.dangerRgb} !important;
        --accent-soft: rgba(${tokens.accentRgb},.12) !important;
        --lyric-font-size: ${size}px !important;
        --lyric-font-family: ${font} !important;
      }
    `;
  }, [themeMode, themeColor, lyricSize, lyricFont]);

  return (
    <ThemeContext.Provider value={value}>
      <style id="tunefree-dynamic-theme" dangerouslySetInnerHTML={{ __html: styleContent }} />
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
