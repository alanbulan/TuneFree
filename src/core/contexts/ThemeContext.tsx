'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeColor = 'red' | 'blue' | 'green' | 'purple' | 'orange';

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

const COLOR_MAP: Record<ThemeColor, { light: string; lightRgb: string; dark: string; darkRgb: string }> = {
  red: {
    light: '#fa233b',
    lightRgb: '250, 35, 59',
    dark: '#ff455b',
    darkRgb: '255, 69, 91',
  },
  blue: {
    light: '#007aff',
    lightRgb: '0, 122, 255',
    dark: '#0a84ff',
    darkRgb: '10, 132, 255',
  },
  green: {
    light: '#34c759',
    lightRgb: '52, 199, 89',
    dark: '#30d158',
    darkRgb: '48, 209, 88',
  },
  purple: {
    light: '#af52de',
    lightRgb: '175, 82, 222',
    dark: '#bf5af2',
    darkRgb: '191, 90, 242',
  },
  orange: {
    light: '#ff9500',
    lightRgb: '255, 149, 0',
    dark: '#ff9f0a',
    darkRgb: '255, 159, 10',
  },
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [themeColor, setThemeColorState] = useState<ThemeColor>('red');
  const [lyricSize, setLyricSizeState] = useState<number>(22);
  const [lyricFont, setLyricFontState] = useState<string>('system-ui');
  const [showDesktopLyric, setShowDesktopLyricState] = useState<boolean>(false);
  const [lockDesktopLyric, setLockDesktopLyricState] = useState<boolean>(false);

  // 从 localStorage 加载配置
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedMode = localStorage.getItem('tunefree_theme_mode') as ThemeMode;
    if (savedMode) setThemeModeState(savedMode);

    const savedColor = localStorage.getItem('tunefree_theme_color') as ThemeColor;
    if (savedColor) setThemeColorState(savedColor);

    const savedLyricSize = localStorage.getItem('tunefree_lyric_size');
    if (savedLyricSize) setLyricSizeState(parseInt(savedLyricSize, 10));

    const savedLyricFont = localStorage.getItem('tunefree_lyric_font');
    if (savedLyricFont) setLyricFontState(savedLyricFont);

    const savedShowDesktopLyric = localStorage.getItem('tunefree_show_desktop_lyric');
    if (savedShowDesktopLyric) setShowDesktopLyricState(savedShowDesktopLyric === 'true');

    const savedLockDesktopLyric = localStorage.getItem('tunefree_lock_desktop_lyric');
    if (savedLockDesktopLyric) setLockDesktopLyricState(savedLockDesktopLyric === 'true');
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    localStorage.setItem('tunefree_theme_mode', mode);
  };

  const setThemeColor = (color: ThemeColor) => {
    setThemeColorState(color);
    localStorage.setItem('tunefree_theme_color', color);
  };

  const setLyricSize = (size: number) => {
    setLyricSizeState(size);
    localStorage.setItem('tunefree_lyric_size', size.toString());
  };

  const setLyricFont = (font: string) => {
    setLyricFontState(font);
    localStorage.setItem('tunefree_lyric_font', font);
  };

  const setShowDesktopLyric = (show: boolean) => {
    setShowDesktopLyricState(show);
    localStorage.setItem('tunefree_show_desktop_lyric', show ? 'true' : 'false');
  };

  const setLockDesktopLyric = (lock: boolean) => {
    setLockDesktopLyricState(lock);
    localStorage.setItem('tunefree_lock_desktop_lyric', lock ? 'true' : 'false');
  };

  // 应用主题模式（深色/浅色/系统）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const htmlEl = document.documentElement;

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        htmlEl.classList.add('dark-theme');
        htmlEl.classList.remove('light-theme');
      } else {
        htmlEl.classList.remove('dark-theme');
        htmlEl.classList.add('light-theme');
      }
    };

    if (themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches);

      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      applyTheme(themeMode === 'dark');
    }
  }, [themeMode]);

  // 应用主题色与歌词配置到全局 CSS 变量
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const htmlEl = document.documentElement;

    // 检查当前是否为深色模式
    const isDark = htmlEl.classList.contains('dark-theme');
    const colorConfig = COLOR_MAP[themeColor];
    const hexColor = isDark ? colorConfig.dark : colorConfig.light;
    const rgbColor = isDark ? colorConfig.darkRgb : colorConfig.lightRgb;

    htmlEl.style.setProperty('--accent', hexColor);
    htmlEl.style.setProperty('--play', hexColor);
    htmlEl.style.setProperty('--danger', hexColor);
    htmlEl.style.setProperty('--accent-rgb', rgbColor);

    // 设置歌词大小与字体
    htmlEl.style.setProperty('--lyric-font-size', `${lyricSize}px`);
    htmlEl.style.setProperty('--lyric-font-family', lyricFont);
  }, [themeColor, themeMode, lyricSize, lyricFont]);

  // 当系统深色模式发生变化时，如果 themeMode 是 'system'，我们需要动态更新主题强调色 hex 颜色
  useEffect(() => {
    if (typeof window === 'undefined' || themeMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const htmlEl = document.documentElement;
      const isDark = htmlEl.classList.contains('dark-theme');
      const colorConfig = COLOR_MAP[themeColor];
      const hexColor = isDark ? colorConfig.dark : colorConfig.light;
      const rgbColor = isDark ? colorConfig.darkRgb : colorConfig.lightRgb;

      htmlEl.style.setProperty('--accent', hexColor);
      htmlEl.style.setProperty('--play', hexColor);
      htmlEl.style.setProperty('--danger', hexColor);
      htmlEl.style.setProperty('--accent-rgb', rgbColor);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [themeColor, themeMode]);

  // 跨窗口同步 Tauri 歌词窗口的显示与隐藏
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    if (!isTauri) return;

    let active = true;

    const manageWindow = async () => {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const lyricWindow = await WebviewWindow.getByLabel('desktop-lyric');

        if (lyricWindow) {
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
