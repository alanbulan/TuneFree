import { applyStoredThemeToDocument, DEFAULT_THEME_PREFERENCES } from '../../../src/core/utils/theme';
import type { DesktopLyricStyleState } from './types';

export const readAndApplyDesktopLyricTheme = (): DesktopLyricStyleState => {
  if (typeof window === 'undefined') {
    return { size: DEFAULT_THEME_PREFERENCES.lyricSize, font: 'system-ui', lock: false };
  }

  const { preferences } = applyStoredThemeToDocument(localStorage, document.documentElement);
  return {
    size: preferences.lyricSize,
    font: preferences.lyricFont,
    lock: preferences.lockDesktopLyric,
  };
};
