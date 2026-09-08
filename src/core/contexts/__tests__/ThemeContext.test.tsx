// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME_PREFERENCES,
  LYRIC_FONT_OPTIONS,
  hexToRgbStr,
  lightenForDark,
  THEME_STORAGE_KEYS,
} from '../../utils/theme';
import { ThemeProvider, useTheme } from '../ThemeContext';

const ipc = vi.hoisted(() => ({
  native: false,
  emitEventTo: vi.fn(() => Promise.resolve()),
  invokeCommand: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../ipc', () => ({
  isTauri: () => ipc.native,
  emitEventTo: ipc.emitEventTo,
  invokeCommand: ipc.invokeCommand,
}));

interface FakeMediaQuery {
  matches: boolean;
  listeners: Set<() => void>;
}

const darkMedia: FakeMediaQuery = { matches: false, listeners: new Set() };

const installMatchMedia = () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    media: query,
    get matches() {
      return query.includes('dark') ? darkMedia.matches : false;
    },
    addEventListener: (_event: string, listener: () => void) => {
      if (query.includes('dark')) darkMedia.listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: () => void) => {
      darkMedia.listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
  })));
};

const flipSystemTheme = (matches: boolean) => {
  darkMedia.matches = matches;
  act(() => {
    darkMedia.listeners.forEach((listener) => listener());
  });
};

let api: ReturnType<typeof useTheme> | null = null;

const Probe = () => {
  const value = useTheme();
  useLayoutEffect(() => { api = value; }, [value]);
  return null;
};

const readVar = (name: string) => document.documentElement.style.getPropertyValue(name);

const mount = () => render(<ThemeProvider><Probe /></ThemeProvider>);

describe('ThemeContext 主题下发', () => {
  beforeEach(() => {
    ipc.native = false;
    ipc.invokeCommand.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
    darkMedia.matches = false;
    darkMedia.listeners.clear();
    api = null;
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    installMatchMedia();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'startViewTransition');
  });

  it('原生窗口命令失败后后续显隐和锁定仍能同步', async () => {
    ipc.native = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    ipc.invokeCommand.mockRejectedValueOnce(new Error('显隐失败')).mockRejectedValueOnce(new Error('锁定失败'));
    mount(); await act(async () => {});
    expect(error).toHaveBeenCalledWith('Tauri window management failed:', expect.any(Error));
    expect(error).toHaveBeenCalledWith('Tauri lyric lock management failed:', expect.any(Error));
    act(() => { api?.setShowDesktopLyric(true); api?.setLockDesktopLyric(true); });
    await act(async () => {});
    expect(ipc.invokeCommand).toHaveBeenCalledWith('show_desktop_lyric_window', { lock: true });
    expect(ipc.invokeCommand).toHaveBeenCalledWith('set_desktop_lyric_lock', { lock: true });
  });

  it('system 模式下 OS 主题切换会实时改写 CSS 变量', () => {
    localStorage.setItem(THEME_STORAGE_KEYS.mode, 'system');
    localStorage.setItem(THEME_STORAGE_KEYS.color, '#007aff');
    mount();

    expect(document.documentElement.classList.contains('light-theme')).toBe(true);
    expect(readVar('--accent')).toBe('#007aff');
    expect(readVar('--accent-rgb')).toBe(hexToRgbStr('#007aff'));

    flipSystemTheme(true);

    const brightened = lightenForDark('#007aff');
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
    expect(document.documentElement.classList.contains('light-theme')).toBe(false);
    // 回归点：此前变量由陈旧闭包二次写入，深色下 accent 仍停在浅色值。
    expect(readVar('--accent')).toBe(brightened);
    expect(readVar('--accent-rgb')).toBe(hexToRgbStr(brightened));

    flipSystemTheme(false);
    expect(readVar('--accent')).toBe('#007aff');
    expect(document.documentElement.classList.contains('light-theme')).toBe(true);
  });

  it('固定模式不跟随 OS 变化', () => {
    localStorage.setItem(THEME_STORAGE_KEYS.mode, 'light');
    mount();
    expect(darkMedia.listeners.size).toBe(0);

    flipSystemTheme(true);
    expect(document.documentElement.classList.contains('light-theme')).toBe(true);
  });

  it('首帧不触发 View Transition，之后的主题切换才用', () => {
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true, writable: true, value: startViewTransition,
    });
    localStorage.setItem(THEME_STORAGE_KEYS.mode, 'dark');
    mount();

    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
    expect(startViewTransition).not.toHaveBeenCalled();

    act(() => api?.setThemeMode('light'));
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('light-theme')).toBe(true);
  });

  it('歌词字体白名单拒绝任意值并落回默认', () => {
    mount();

    act(() => api?.setLyricFont('evil; } html { display:none } /*'));
    expect(api?.lyricFont).toBe(DEFAULT_THEME_PREFERENCES.lyricFont);
    expect(readVar('--lyric-font-family')).toBe(DEFAULT_THEME_PREFERENCES.lyricFont);
    expect(localStorage.getItem(THEME_STORAGE_KEYS.lyricFont))
      .toBe(DEFAULT_THEME_PREFERENCES.lyricFont);

    const allowed = LYRIC_FONT_OPTIONS[2].value;
    act(() => api?.setLyricFont(allowed));
    expect(readVar('--lyric-font-family')).toBe(allowed);
    expect(localStorage.getItem(THEME_STORAGE_KEYS.lyricFont)).toBe(allowed);
  });

  it('主题色与歌词字号写入前先归一化', () => {
    mount();

    act(() => api?.setThemeColor('随便写的'));
    expect(api?.themeColor).toBe(DEFAULT_THEME_PREFERENCES.themeColor);

    act(() => api?.setThemeColor('#ABC'));
    expect(readVar('--accent')).toBe('#aabbcc');

    act(() => api?.setLyricSize(999));
    expect(readVar('--lyric-font-size')).toBe('36px');
    expect(localStorage.getItem(THEME_STORAGE_KEYS.lyricSize)).toBe('36');
  });
});
