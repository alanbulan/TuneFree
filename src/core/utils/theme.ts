export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeColor = string; // Any hex color like '#fa233b'

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

export const DEFAULT_ACCENT_COLOR = '#fa233b';
export const DEFAULT_DANGER_COLOR = '#fa233b';

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  themeMode: 'system',
  themeColor: DEFAULT_ACCENT_COLOR,
  lyricSize: 22,
  lyricFont: 'system-ui',
  showDesktopLyric: false,
  lockDesktopLyric: false,
};

/**
 * Preset color palette for the theme color picker.
 * 12 curated colors covering the full hue spectrum.
 */
export const PRESET_COLORS: ReadonlyArray<{ name: string; color: string }> = [
  { name: '玫瑰红', color: '#fa233b' },
  { name: '樱花粉', color: '#ff2d55' },
  { name: '珊瑚橙', color: '#ff6b35' },
  { name: '活力橙', color: '#ff9500' },
  { name: '柠檬黄', color: '#ffcc00' },
  { name: '极光绿', color: '#34c759' },
  { name: '薄荷青', color: '#00c7be' },
  { name: '星海蓝', color: '#007aff' },
  { name: '靛蓝', color: '#5856d6' },
  { name: '丁香紫', color: '#af52de' },
  { name: '玫瑰金', color: '#bf5959' },
  { name: '石墨灰', color: '#8e8e93' },
];

/**
 * Legacy named colors for backward compatibility with old localStorage values.
 */
const LEGACY_COLOR_MAP: Record<string, string> = {
  red: '#fa233b',
  blue: '#007aff',
  green: '#34c759',
  purple: '#af52de',
  orange: '#ff9500',
};

// ─── Hex color utilities ─────────────────────────────────────────

/** Validate that a string is a 3- or 6-digit hex color (with or without #). */
export const isValidHex = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
};

/** Normalize a hex string to 6-digit form with leading #. */
const normalizeHex = (hex: string): string => {
  let h = hex.trim();
  if (!h.startsWith('#')) h = '#' + h;
  if (h.length === 4) {
    // Expand shorthand: #abc → #aabbcc
    h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h.toLowerCase();
};

/** Convert hex to {r, g, b}. */
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const h = normalizeHex(hex);
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
};

/** Convert hex to "r, g, b" string for use in CSS rgba(). */
export const hexToRgbStr = (hex: string): string => {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
};

/** RGB to HSL conversion. Returns {h, s, l} with h in degrees, s/l in percent. */
const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;

  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));

    switch (max) {
      case rN:
        h = ((gN - bN) / delta) % 6;
        break;
      case gN:
        h = (bN - rN) / delta + 2;
        break;
      case bN:
        h = (rN - gN) / delta + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
};

/** HSL to hex conversion. */
const hslToHex = (h: number, s: number, l: number): string => {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  const toHex = (n: number) => {
    const v = Math.round((n + m) * 255);
    return v.toString(16).padStart(2, '0');
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Generate a slightly brighter variant for dark mode.
 * Increases lightness by 8 percentage points (capped at 72%).
 */
export const lightenForDark = (hex: string): string => {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const newL = Math.min(72, l + 8);
  return hslToHex(h, s, newL);
};

/**
 * Resolve any input (legacy named color or hex string) to a valid hex color.
 */
export const resolveHexColor = (value: unknown): string => {
  if (typeof value === 'string') {
    // Check legacy named colors first
    const legacy = LEGACY_COLOR_MAP[value];
    if (legacy) return legacy;
    // Then check if it's a valid hex
    if (isValidHex(value)) return normalizeHex(value);
  }
  return DEFAULT_ACCENT_COLOR;
};

// ─── Theme normalization & resolution ────────────────────────────

const THEME_MODES = new Set<ThemeMode>(['light', 'dark', 'system']);

export const normalizeThemeMode = (value: unknown): ThemeMode => {
  return typeof value === 'string' && THEME_MODES.has(value as ThemeMode)
    ? (value as ThemeMode)
    : DEFAULT_THEME_PREFERENCES.themeMode;
};

export const normalizeThemeColor = (value: unknown): ThemeColor => {
  return resolveHexColor(value);
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
  const baseHex = resolveHexColor(color);
  const accentHex = isDark ? lightenForDark(baseHex) : baseHex;
  const accentRgb = hexToRgbStr(accentHex);

  // Danger is always red regardless of theme color
  const dangerHex = isDark ? lightenForDark(DEFAULT_DANGER_COLOR) : DEFAULT_DANGER_COLOR;
  const dangerRgb = hexToRgbStr(dangerHex);

  return {
    accent: accentHex,
    accentRgb,
    play: accentHex,
    danger: dangerHex,
    dangerRgb,
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
  target.style.setProperty('--accent-soft', `rgba(${tokens.accentRgb},.12)`);

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
