import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [initialPreferences] = useState(() =>
    typeof window === 'undefined'
      ? DEFAULT_THEME_PREFERENCES
      : readThemePreferences(localStorage),
  );
  const [themeMode, setThemeModeState] = useState<ThemeMode>(
    initialPreferences.themeMode,
  );
  const [themeColor, setThemeColorState] = useState<ThemeColor>(
    initialPreferences.themeColor,
  );
  const [lyricSize, setLyricSizeState] = useState<number>(
    initialPreferences.lyricSize,
  );
  const [lyricFont, setLyricFontState] = useState<string>(
    initialPreferences.lyricFont,
  );

  const setThemeMode = useCallback((mode: ThemeMode) => {
    const safeMode = normalizeThemeMode(mode);
    setThemeModeState(safeMode);
    try {
      localStorage.setItem(THEME_STORAGE_KEYS.mode, safeMode);
    } catch {
      /* 隐私模式 / 配额不足时忽略 */
    }
  }, []);

  const setThemeColor = useCallback((color: ThemeColor) => {
    const safeColor = normalizeThemeColor(color);
    setThemeColorState(safeColor);
    try {
      localStorage.setItem(THEME_STORAGE_KEYS.color, safeColor);
    } catch {
      /* ignore */
    }
  }, []);

  const setLyricSize = useCallback((size: number) => {
    const safeSize = clampLyricSize(size);
    setLyricSizeState(safeSize);
    try {
      localStorage.setItem(THEME_STORAGE_KEYS.lyricSize, safeSize.toString());
    } catch {
      /* ignore */
    }
  }, []);

  const setLyricFont = useCallback((font: string) => {
    // 只接受白名单内的值，防止任意字符串注入 CSS 变量。
    const safeFont = normalizeLyricFont(font);
    setLyricFontState(safeFont);
    try {
      localStorage.setItem(THEME_STORAGE_KEYS.lyricFont, safeFont);
    } catch {
      /* ignore */
    }
  }, []);

  // 把主题下发到 <html> 的 class 与 CSS 变量；system 模式跟随 OS 实时变化。
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const htmlEl = document.documentElement;
    const applyTheme = () => {
      const isDark = resolveThemeIsDark(themeMode);
      const tokens = resolveThemeTokens(themeMode, themeColor, isDark);
      applyThemeClasses(htmlEl, isDark);
      applyThemeVariables(htmlEl, tokens, { lyricSize, lyricFont });

      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', isDark ? '#09090b' : '#f2f2f7');
    };

    applyTheme();

    if (themeMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [themeMode, themeColor, lyricSize, lyricFont]);

  const value = useMemo<ThemeContextType>(
    () => ({
      themeMode,
      setThemeMode,
      themeColor,
      setThemeColor,
      lyricSize,
      setLyricSize,
      lyricFont,
      setLyricFont,
    }),
    [
      themeMode,
      setThemeMode,
      themeColor,
      setThemeColor,
      lyricSize,
      setLyricSize,
      lyricFont,
      setLyricFont,
    ],
  );

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
