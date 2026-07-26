import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_PREFERENCES,
  LYRIC_FONT_OPTIONS,
  applyThemeVariables,
  clampLyricSize,
  normalizeLyricFont,
  normalizeThemeColor,
  normalizeThemeMode,
  readThemePreferences,
  resolveThemeIsDark,
  resolveThemeTokens,
  THEME_STORAGE_KEYS,
} from '../theme';

const createStorage = (entries: Record<string, string>): Storage => ({
  getItem: (key: string) => entries[key] ?? null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
}) as Storage;

const createTarget = () => {
  const properties: Record<string, string> = {};
  const element = {
    style: {
      setProperty: (name: string, value: string) => {
        properties[name] = value;
      },
    },
  } as unknown as HTMLElement;
  return { element, properties };
};

describe('normalizeLyricFont', () => {
  it('accepts every value offered by the appearance dropdown', () => {
    for (const option of LYRIC_FONT_OPTIONS) {
      expect(normalizeLyricFont(option.value)).toBe(option.value);
    }
    expect(normalizeLyricFont(DEFAULT_THEME_PREFERENCES.lyricFont))
      .toBe(DEFAULT_THEME_PREFERENCES.lyricFont);
  });

  it('rejects arbitrary strings that could break out of the CSS value', () => {
    expect(normalizeLyricFont('serif; } html { display: none; } /*'))
      .toBe(DEFAULT_THEME_PREFERENCES.lyricFont);
    expect(normalizeLyricFont('Comic Sans MS')).toBe(DEFAULT_THEME_PREFERENCES.lyricFont);
    expect(normalizeLyricFont('')).toBe(DEFAULT_THEME_PREFERENCES.lyricFont);
    expect(normalizeLyricFont(null)).toBe(DEFAULT_THEME_PREFERENCES.lyricFont);
    expect(normalizeLyricFont(42)).toBe(DEFAULT_THEME_PREFERENCES.lyricFont);
  });

  it('tolerates surrounding whitespace on whitelisted values', () => {
    const font = LYRIC_FONT_OPTIONS[1].value;
    expect(normalizeLyricFont(`  ${font}  `)).toBe(font);
  });
});

describe('readThemePreferences', () => {
  it('falls back to defaults for tampered storage values', () => {
    const preferences = readThemePreferences(createStorage({
      [THEME_STORAGE_KEYS.mode]: 'neon',
      [THEME_STORAGE_KEYS.color]: 'not-a-color',
      [THEME_STORAGE_KEYS.lyricSize]: '999',
      [THEME_STORAGE_KEYS.lyricFont]: 'evil}',
    }));
    expect(preferences.themeMode).toBe(DEFAULT_THEME_PREFERENCES.themeMode);
    expect(preferences.themeColor).toBe(DEFAULT_THEME_PREFERENCES.themeColor);
    expect(preferences.lyricSize).toBe(36);
    expect(preferences.lyricFont).toBe(DEFAULT_THEME_PREFERENCES.lyricFont);
    expect(preferences.showDesktopLyric).toBe(false);
  });

  it('keeps valid stored values', () => {
    const font = LYRIC_FONT_OPTIONS[2].value;
    const preferences = readThemePreferences(createStorage({
      [THEME_STORAGE_KEYS.mode]: 'dark',
      [THEME_STORAGE_KEYS.color]: '#00c7be',
      [THEME_STORAGE_KEYS.lyricSize]: '28',
      [THEME_STORAGE_KEYS.lyricFont]: font,
      [THEME_STORAGE_KEYS.showDesktopLyric]: 'true',
      [THEME_STORAGE_KEYS.lockDesktopLyric]: 'true',
    }));
    expect(preferences).toEqual({
      themeMode: 'dark',
      themeColor: '#00c7be',
      lyricSize: 28,
      lyricFont: font,
      showDesktopLyric: true,
      lockDesktopLyric: true,
    });
  });
});

describe('applyThemeVariables', () => {
  it('writes accent tokens through setProperty without !important', () => {
    const { element, properties } = createTarget();
    const tokens = resolveThemeTokens('light', '#007aff', false);

    applyThemeVariables(element, tokens);

    expect(properties['--accent']).toBe('#007aff');
    expect(properties['--accent-rgb']).toBe('0, 122, 255');
    expect(properties['--accent-soft']).toBe('rgba(0, 122, 255,.12)');
  });

  it('sanitizes the lyric font before it reaches the CSS custom property', () => {
    const { element, properties } = createTarget();
    const tokens = resolveThemeTokens('dark', '#fa233b', true);

    applyThemeVariables(element, tokens, { lyricSize: 999, lyricFont: 'x; }*{display:none}' });

    expect(properties['--lyric-font-size']).toBe('36px');
    expect(properties['--lyric-font-family']).toBe(DEFAULT_THEME_PREFERENCES.lyricFont);
  });
});

describe('theme resolution helpers', () => {
  it('resolves dark mode from the explicit mode or the system preference', () => {
    expect(resolveThemeIsDark('dark', false)).toBe(true);
    expect(resolveThemeIsDark('light', true)).toBe(false);
    expect(resolveThemeIsDark('system', true)).toBe(true);
    expect(resolveThemeIsDark('system', false)).toBe(false);
  });

  it('brightens the accent in dark mode only', () => {
    expect(resolveThemeTokens('light', '#fa233b', false).accent).toBe('#fa233b');
    expect(resolveThemeTokens('dark', '#fa233b', true).accent).not.toBe('#fa233b');
  });

  it('normalizes modes, colors and sizes', () => {
    expect(normalizeThemeMode('light')).toBe('light');
    expect(normalizeThemeMode('sepia')).toBe(DEFAULT_THEME_PREFERENCES.themeMode);
    expect(normalizeThemeColor('red')).toBe('#fa233b');
    expect(normalizeThemeColor('#ABC')).toBe('#aabbcc');
    expect(clampLyricSize(4)).toBe(14);
    expect(clampLyricSize('20')).toBe(20);
  });
});
