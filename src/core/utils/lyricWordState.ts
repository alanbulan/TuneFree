/**
 * Shared per-word karaoke timing helpers, reused by the main-window karaoke
 * renderer and the desktop-lyric synchronized translation renderer.
 */

export type LyricWordState = 'pending' | 'active' | 'done';

/** Resolve the three-state highlight of a timed word at the given clock. */
export const getLyricWordState = (
  start: number,
  duration: number,
  currentTime: number,
): LyricWordState => {
  if (duration === 0) return currentTime < start ? 'pending' : 'done';
  if (currentTime >= start + duration) return 'done';
  if (currentTime >= start) return 'active';
  return 'pending';
};

/** Resolve the 0..1 fill ratio of a timed word at the given clock. */
export const getLyricWordProgress = (
  start: number,
  duration: number,
  currentTime: number,
): number => {
  if (duration === 0) return currentTime < start ? 0 : 1;
  return Math.max(0, Math.min(1, (currentTime - start) / duration));
};

/**
 * Format a 0..1 ratio as the CSS `--word-progress` percentage string
 * consumed by the gradient text-fill rules (e.g. "37.5%").
 */
export const formatWordProgress = (progress: number): string => {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return `${(clamped * 100).toFixed(1)}%`;
};
