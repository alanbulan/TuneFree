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

export const forceTransparentDocument = () => {
  if (typeof document === 'undefined') return;

  document.documentElement.style.setProperty('background', 'transparent', 'important');
  document.body.style.setProperty('background', 'transparent', 'important');
  document.documentElement.style.setProperty('background-color', 'transparent', 'important');
  document.body.style.setProperty('background-color', 'transparent', 'important');
};
