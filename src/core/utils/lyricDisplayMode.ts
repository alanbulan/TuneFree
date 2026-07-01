export type LyricDisplayMode = 'line' | 'karaoke';

export const LYRIC_DISPLAY_MODE_STORAGE_KEY = 'tunefree_lyric_display_mode';
export const LYRIC_DISPLAY_MODE_CHANGE_EVENT = 'tunefree_lyric_display_mode_change';
export const DEFAULT_LYRIC_DISPLAY_MODE: LyricDisplayMode = 'line';

export const normalizeLyricDisplayMode = (value: unknown): LyricDisplayMode =>
  value === 'karaoke' ? 'karaoke' : DEFAULT_LYRIC_DISPLAY_MODE;

export const readLyricDisplayMode = (
  storage: Pick<Storage, 'getItem'> | null | undefined =
    typeof window !== 'undefined' ? window.localStorage : null,
): LyricDisplayMode => {
  try {
    return normalizeLyricDisplayMode(storage?.getItem(LYRIC_DISPLAY_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_LYRIC_DISPLAY_MODE;
  }
};

export const saveLyricDisplayMode = (mode: LyricDisplayMode): void => {
  if (typeof window === 'undefined') return;

  const normalized = normalizeLyricDisplayMode(mode);
  localStorage.setItem(LYRIC_DISPLAY_MODE_STORAGE_KEY, normalized);
  window.dispatchEvent(new CustomEvent(LYRIC_DISPLAY_MODE_CHANGE_EVENT, { detail: normalized }));
};
