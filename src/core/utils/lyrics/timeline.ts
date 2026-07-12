import { parseLyrics } from './publicApi';

const MIN_OVERRUN_TOLERANCE_SECONDS = 15;
const OVERRUN_TOLERANCE_RATIO = 0.05;
export const LYRIC_VERSION_MISMATCH_MESSAGE = '歌词版本与当前音源可能不匹配，播放不受影响';

export interface LyricTimelineAnalysis {
  status: 'unavailable' | 'ok' | 'overrun';
  durationSeconds: number;
  lastLineTimeSeconds: number | null;
  overrunSeconds: number;
  outOfRangeLineCount: number;
}

export const analyzeLyricTimeline = (
  lrc: string | undefined,
  durationSeconds: number,
): LyricTimelineAnalysis => {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds : 0;
  const rows = parseLyrics(lrc);
  if (safeDuration === 0 || rows.length === 0) {
    return {
      status: 'unavailable',
      durationSeconds: safeDuration,
      lastLineTimeSeconds: rows.length > 0 ? rows[rows.length - 1].time : null,
      overrunSeconds: 0,
      outOfRangeLineCount: 0,
    };
  }

  const lastLineTimeSeconds = rows.reduce((latest, row) => Math.max(latest, row.time), 0);
  const overrunSeconds = Math.max(0, lastLineTimeSeconds - safeDuration);
  const toleranceSeconds = Math.max(
    MIN_OVERRUN_TOLERANCE_SECONDS,
    safeDuration * OVERRUN_TOLERANCE_RATIO,
  );
  const outOfRangeLineCount = rows.filter((row) => row.time > safeDuration).length;
  const hasVersionMismatchSignal = overrunSeconds > toleranceSeconds && outOfRangeLineCount >= 2;

  return {
    status: hasVersionMismatchSignal ? 'overrun' : 'ok',
    durationSeconds: safeDuration,
    lastLineTimeSeconds,
    overrunSeconds,
    outOfRangeLineCount,
  };
};
