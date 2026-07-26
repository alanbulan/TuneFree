import { applyStoredThemeToDocument } from '../../../src/core/utils/theme';
import type { DesktopLyricStyleState } from './types';

export const readAndApplyDesktopLyricTheme = (): DesktopLyricStyleState => {
  if (typeof window === 'undefined') {
    return { size: 22, font: 'system-ui', lock: false };
  }

  const { preferences } = applyStoredThemeToDocument(localStorage, document.documentElement);
  return {
    size: preferences.lyricSize,
    font: preferences.lyricFont,
    lock: preferences.lockDesktopLyric,
  };
};
