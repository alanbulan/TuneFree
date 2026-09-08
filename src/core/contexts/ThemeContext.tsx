'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { emitEventTo, invokeCommand, isTauri } from '../ipc';
import {
  applyThemeClasses,
  applyThemeVariables,
  clampLyricSize,
  DEFAULT_THEME_PREFERENCES,
  normalizeLyricFont,
  normalizeThemeColor,
  normalizeThemeMode,
  readThemePreferences,
  resolveThemeIsDark,
  resolveThemeTokens,
  THEME_STORAGE_KEYS,
  type ThemeColor,
  type ThemeMode,
  type ThemeTokens,
} from '../utils/theme';

export type { ThemeColor, ThemeMode } from '../utils/theme';

const DESKTOP_LYRIC_WINDOW = 'desktop-lyric';

/** 主题变化后同步给歌词窗口；窗口未开启时静默失败即可。 */
const notifyDesktopLyricTheme = (isDark: boolean, tokens: ThemeTokens, lyricFont: string) => {
  if (!isTauri()) return;
  emitEventTo(DESKTOP_LYRIC_WINDOW, 'theme-changed', {
    isDark,
    accent: tokens.accent,
    accentRgb: tokens.accentRgb,
    lyricFontFamily: normalizeLyricFont(lyricFont),
  }).catch(() => {});
};

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
  const [initialPreferences] = useState(() => (
    typeof window === 'undefined' ? DEFAULT_THEME_PREFERENCES : readThemePreferences(localStorage)
  ));
  const [themeMode, setThemeModeState] = useState<ThemeMode>(initialPreferences.themeMode);
  const [themeColor, setThemeColorState] = useState<ThemeColor>(initialPreferences.themeColor);
  const [lyricSize, setLyricSizeState] = useState<number>(initialPreferences.lyricSize);
  const [lyricFont, setLyricFontState] = useState<string>(initialPreferences.lyricFont);
  const [showDesktopLyric, setShowDesktopLyricState] = useState<boolean>(initialPreferences.showDesktopLyric);
  const [lockDesktopLyric, setLockDesktopLyricState] = useState<boolean>(initialPreferences.lockDesktopLyric);
  const desktopLyricCommandQueue = useRef<Promise<void>>(Promise.resolve());
  const lockDesktopLyricRef = useRef(lockDesktopLyric);
  const hasAppliedThemeRef = useRef(false);

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
    // 只接受字体下拉白名单内的值，防止任意字符串注入 CSS 变量
    const safeFont = normalizeLyricFont(font);
    setLyricFontState(safeFont);
    localStorage.setItem(THEME_STORAGE_KEYS.lyricFont, safeFont);
  }, []);

  const setShowDesktopLyric = useCallback((show: boolean) => {
    setShowDesktopLyricState(show);
    localStorage.setItem(THEME_STORAGE_KEYS.showDesktopLyric, show ? 'true' : 'false');
  }, []);

  const setLockDesktopLyric = useCallback((lock: boolean) => {
    lockDesktopLyricRef.current = lock;
    setLockDesktopLyricState(lock);
    localStorage.setItem(THEME_STORAGE_KEYS.lockDesktopLyric, lock ? 'true' : 'false');
  }, []);

  // 应用主题模式、主题色与歌词配置到全局 CSS 变量（唯一下发机制，
  // 与歌词窗口的 applyStoredThemeToDocument 走同一函数）；system 模式跟随 OS 实时变化
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

      // 首次应用不走 View Transition：首帧主题已由 index.html 的引导脚本写好，
      // 此处只是幂等地重写同样的 class 与变量，动画会造成无意义的闪烁
      const isFirstApply = !hasAppliedThemeRef.current;
      hasAppliedThemeRef.current = true;

      const vt = (document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } });
      const classAlreadyCorrect = htmlEl.classList.contains('dark-theme') === isDark;
      if (isFirstApply || classAlreadyCorrect || typeof vt.startViewTransition !== 'function') {
        runSwitch();
      } else {
        const transition = vt.startViewTransition(runSwitch);
        transition.finished.catch(() => {});
      }

      notifyDesktopLyricTheme(isDark, tokens, lyricFont);
    };

    applyTheme();

    if (themeMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [themeMode, themeColor, lyricSize, lyricFont]);

  // 串行同步歌词窗口显隐，避免快速关闭/重开时旧命令覆盖最新状态。
  useEffect(() => {
    if (!isTauri()) return;

    desktopLyricCommandQueue.current = desktopLyricCommandQueue.current.catch(() => {}).then(async () => {
      try {
        if (showDesktopLyric) {
          await invokeCommand('show_desktop_lyric_window', { lock: lockDesktopLyricRef.current });
        } else {
          await invokeCommand('hide_desktop_lyric_window');
        }
      } catch (err) {
        console.error('Tauri window management failed:', err);
      }
    });
  }, [showDesktopLyric]);

  // 锁定变化只更新焦点和鼠标穿透，不触发布局恢复或窗口显隐。
  useEffect(() => {
    if (!isTauri()) return;

    desktopLyricCommandQueue.current = desktopLyricCommandQueue.current.catch(() => {}).then(async () => {
      try {
        await invokeCommand('set_desktop_lyric_lock', { lock: lockDesktopLyric });
      } catch (err) {
        console.error('Tauri lyric lock management failed:', err);
      }
    });
  }, [lockDesktopLyric]);

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

  return (
    <ThemeContext.Provider value={value}>
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
