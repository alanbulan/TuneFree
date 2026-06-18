export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeColor = 'red' | 'blue' | 'green' | 'purple' | 'orange';

export interface ThemeColorConfig {
  light: string;
  lightRgb: string;
  dark: string;
  darkRgb: string;
}

export interface ThemePreferences {
  themeMode: ThemeMode;
  themeColor: ThemeColor;
  lyricSize: number;
  lyricFont: string;
  showDesktopLyric: boolean;
  lockDesktopLyric: boolean;
}

export interface ThemeTokens {
  accent: string;
  accentRgb: string;
  play: string;
  danger: string;
  dangerRgb: string;
}

export const THEME_STORAGE_KEYS = {
  mode: 'tunefree_theme_mode',
  color: 'tunefree_theme_color',
  lyricSize: 'tunefree_lyric_size',
  lyricFont: 'tunefree_lyric_font',
  showDesktopLyric: 'tunefree_show_desktop_lyric',
  lockDesktopLyric: 'tunefree_lock_desktop_lyric',
} as const;

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  themeMode: 'system',
  themeColor: 'red',
  lyricSize: 22,
  lyricFont: 'system-ui',
  showDesktopLyric: false,
  lockDesktopLyric: false,
};

export const COLOR_MAP: Record<ThemeColor, ThemeColorConfig> = {
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

const THEME_MODES = new Set<ThemeMode>(['light', 'dark', 'system']);
const THEME_COLORS = new Set<ThemeColor>(['red', 'blue', 'green', 'purple', 'orange']);

export const normalizeThemeMode = (value: unknown): ThemeMode => {
  return typeof value === 'string' && THEME_MODES.has(value as ThemeMode)
    ? (value as ThemeMode)
    : DEFAULT_THEME_PREFERENCES.themeMode;
};

export const normalizeThemeColor = (value: unknown): ThemeColor => {
  return typeof value === 'string' && THEME_COLORS.has(value as ThemeColor)
    ? (value as ThemeColor)
    : DEFAULT_THEME_PREFERENCES.themeColor;
};

export const clampLyricSize = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numeric)) return DEFAULT_THEME_PREFERENCES.lyricSize;
  return Math.max(14, Math.min(36, numeric));
};

export const getSystemPrefersDark = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export const resolveThemeIsDark = (mode: ThemeMode, systemPrefersDark = getSystemPrefersDark()) => {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark);
};

export const resolveThemeTokens = (mode: ThemeMode, color: ThemeColor, isDark = resolveThemeIsDark(mode)): ThemeTokens => {
  const accentConfig = COLOR_MAP[color] ?? COLOR_MAP.red;
  const dangerConfig = COLOR_MAP.red;

  return {
    accent: isDark ? accentConfig.dark : accentConfig.light,
    accentRgb: isDark ? accentConfig.darkRgb : accentConfig.lightRgb,
    play: isDark ? accentConfig.dark : accentConfig.light,
    danger: isDark ? dangerConfig.dark : dangerConfig.light,
    dangerRgb: isDark ? dangerConfig.darkRgb : dangerConfig.lightRgb,
  };
};

export const applyThemeClasses = (target: HTMLElement, isDark: boolean) => {
  target.classList.toggle('dark-theme', isDark);
  target.classList.toggle('light-theme', !isDark);
};

export const applyThemeVariables = (
  target: HTMLElement,
  tokens: ThemeTokens,
  lyric?: Pick<ThemePreferences, 'lyricSize' | 'lyricFont'>,
) => {
  target.style.setProperty('--accent', tokens.accent);
  target.style.setProperty('--play', tokens.play);
  target.style.setProperty('--danger', tokens.danger);
  target.style.setProperty('--accent-rgb', tokens.accentRgb);
  target.style.setProperty('--danger-rgb', tokens.dangerRgb);

  if (lyric) {
    target.style.setProperty('--lyric-font-size', `${clampLyricSize(lyric.lyricSize)}px`);
    target.style.setProperty('--lyric-font-family', lyric.lyricFont || DEFAULT_THEME_PREFERENCES.lyricFont);
  }
};

export const readThemePreferences = (storage: Storage): ThemePreferences => {
  return {
    themeMode: normalizeThemeMode(storage.getItem(THEME_STORAGE_KEYS.mode)),
    themeColor: normalizeThemeColor(storage.getItem(THEME_STORAGE_KEYS.color)),
    lyricSize: clampLyricSize(storage.getItem(THEME_STORAGE_KEYS.lyricSize)),
    lyricFont: storage.getItem(THEME_STORAGE_KEYS.lyricFont) || DEFAULT_THEME_PREFERENCES.lyricFont,
    showDesktopLyric: storage.getItem(THEME_STORAGE_KEYS.showDesktopLyric) === 'true',
    lockDesktopLyric: storage.getItem(THEME_STORAGE_KEYS.lockDesktopLyric) === 'true',
  };
};

export const applyStoredThemeToDocument = (storage: Storage, target: HTMLElement) => {
  const preferences = readThemePreferences(storage);
  const isDark = resolveThemeIsDark(preferences.themeMode);
  const tokens = resolveThemeTokens(preferences.themeMode, preferences.themeColor, isDark);

  applyThemeClasses(target, isDark);
  applyThemeVariables(target, tokens, {
    lyricSize: preferences.lyricSize,
    lyricFont: preferences.lyricFont,
  });

  return { preferences, isDark, tokens };
};
