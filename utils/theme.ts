export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeColor = string; // Any hex color like '#fa233b'

export interface ThemePreferences {
  themeMode: ThemeMode;
  themeColor: ThemeColor;
  lyricSize: number;
  lyricFont: string;
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
} as const;

export const DEFAULT_ACCENT_COLOR = '#fa233b';
export const DEFAULT_DANGER_COLOR = '#fa233b';

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  themeMode: 'system',
  themeColor: DEFAULT_ACCENT_COLOR,
  lyricSize: 22,
  lyricFont: 'system-ui',
};

/**
 * 强调色预设：覆盖完整色相的 12 个颜色。
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
 * 歌词字体白名单。lyricFont 会被插进 CSS 变量，
 * 白名单外的值（篡改的 localStorage、旧数据）一律回退默认，避免任意字符串注入。
 */
export const LYRIC_FONT_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: '系统默认', value: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' },
  { label: '优雅苹方', value: '"PingFang SC", "Helvetica Neue", sans-serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
  { label: '宋体', value: '"SimSun", serif' },
  { label: '华文细黑', value: '"STXihei", "STHeiti", sans-serif' },
];

/** 旧版本用过的命名颜色，兼容历史 localStorage 值。 */
const LEGACY_COLOR_MAP: Record<string, string> = {
  red: '#fa233b',
  blue: '#007aff',
  green: '#34c759',
  purple: '#af52de',
  orange: '#ff9500',
};

// ─── Hex 颜色工具 ─────────────────────────────────────────

/** 校验是否是 3 位或 6 位十六进制颜色（带不带 # 均可）。 */
export const isValidHex = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
};

/** 归一化到 6 位、带 # 的小写形式。 */
const normalizeHex = (hex: string): string => {
  let h = hex.trim();
  if (!h.startsWith('#')) h = '#' + h;
  if (h.length === 4) {
    // 展开缩写：#abc → #aabbcc
    h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h.toLowerCase();
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const h = normalizeHex(hex);
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
};

/** 转成 "r, g, b" 字符串，供 CSS rgba() 使用。 */
export const hexToRgbStr = (hex: string): string => {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
};

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

/** 生成暗色下更亮一档的同色（亮度 +8 个百分点，封顶 72%）。 */
export const lightenForDark = (hex: string): string => {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const newL = Math.min(72, l + 8);
  return hslToHex(h, s, newL);
};

/** 把任意输入（旧命名颜色或 hex）解析成合法 hex。 */
export const resolveHexColor = (value: unknown): string => {
  if (typeof value === 'string') {
    const legacy = LEGACY_COLOR_MAP[value];
    if (legacy) return legacy;
    if (isValidHex(value)) return normalizeHex(value);
  }
  return DEFAULT_ACCENT_COLOR;
};

// ─── 主题归一化与解析 ─────────────────────────────────────

const THEME_MODES = new Set<ThemeMode>(['light', 'dark', 'system']);

export const normalizeThemeMode = (value: unknown): ThemeMode =>
  typeof value === 'string' && THEME_MODES.has(value as ThemeMode)
    ? (value as ThemeMode)
    : DEFAULT_THEME_PREFERENCES.themeMode;

export const normalizeThemeColor = (value: unknown): ThemeColor =>
  resolveHexColor(value);

const LYRIC_FONT_WHITELIST = new Set<string>([
  DEFAULT_THEME_PREFERENCES.lyricFont,
  ...LYRIC_FONT_OPTIONS.map((option) => option.value),
]);

export const normalizeLyricFont = (value: unknown): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (LYRIC_FONT_WHITELIST.has(trimmed)) return trimmed;
  }
  return DEFAULT_THEME_PREFERENCES.lyricFont;
};

export const clampLyricSize = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numeric)) return DEFAULT_THEME_PREFERENCES.lyricSize;
  return Math.max(14, Math.min(36, numeric));
};

export const getSystemPrefersDark = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export const resolveThemeIsDark = (
  mode: ThemeMode,
  systemPrefersDark = getSystemPrefersDark(),
): boolean => mode === 'dark' || (mode === 'system' && systemPrefersDark);

export const resolveThemeTokens = (
  mode: ThemeMode,
  color: ThemeColor,
  isDark = resolveThemeIsDark(mode),
): ThemeTokens => {
  const baseHex = resolveHexColor(color);
  const accentHex = isDark ? lightenForDark(baseHex) : baseHex;
  const accentRgb = hexToRgbStr(accentHex);

  // 危险色始终是红色，不随主题色变化。
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

export const applyThemeClasses = (target: HTMLElement, isDark: boolean): void => {
  target.classList.toggle('dark-theme', isDark);
  target.classList.toggle('light-theme', !isDark);
};

export const applyThemeVariables = (
  target: HTMLElement,
  tokens: ThemeTokens,
  lyric?: Pick<ThemePreferences, 'lyricSize' | 'lyricFont'>,
): void => {
  target.style.setProperty('--accent', tokens.accent);
  target.style.setProperty('--play', tokens.play);
  target.style.setProperty('--danger', tokens.danger);
  target.style.setProperty('--accent-rgb', tokens.accentRgb);
  target.style.setProperty('--danger-rgb', tokens.dangerRgb);
  target.style.setProperty('--accent-soft', `rgba(${tokens.accentRgb},.12)`);

  if (lyric) {
    target.style.setProperty('--lyric-font-size', `${clampLyricSize(lyric.lyricSize)}px`);
    target.style.setProperty('--lyric-font-family', normalizeLyricFont(lyric.lyricFont));
  }
};

export const readThemePreferences = (storage: Storage): ThemePreferences => ({
  themeMode: normalizeThemeMode(storage.getItem(THEME_STORAGE_KEYS.mode)),
  themeColor: normalizeThemeColor(storage.getItem(THEME_STORAGE_KEYS.color)),
  lyricSize: clampLyricSize(storage.getItem(THEME_STORAGE_KEYS.lyricSize)),
  lyricFont: normalizeLyricFont(storage.getItem(THEME_STORAGE_KEYS.lyricFont)),
});

/** 首帧引导与 ThemeProvider 共用同一函数，保证两者结果一致。 */
export const applyStoredThemeToDocument = (
  storage: Storage,
  target: HTMLElement,
): { preferences: ThemePreferences; isDark: boolean; tokens: ThemeTokens } => {
  const preferences = readThemePreferences(storage);
  const isDark = resolveThemeIsDark(preferences.themeMode);
  const tokens = resolveThemeTokens(preferences.themeMode, preferences.themeColor, isDark);

  applyThemeClasses(target, isDark);
  applyThemeVariables(target, tokens, {
    lyricSize: preferences.lyricSize,
    lyricFont: preferences.lyricFont,
  });

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark ? '#09090b' : '#f2f2f7');

  return { preferences, isDark, tokens };
};
