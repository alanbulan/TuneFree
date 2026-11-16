import { parseLyrics } from './publicApi';
import { analyzeLyricTimeline } from './timeline';
import type { ParsedLyric } from './types';

export const hasRealTimedWords = (rows: ParsedLyric[]): boolean => rows.some((row) =>
  row.words?.some((word) => Number.isFinite(word.start) && Number.isFinite(word.duration)
    && word.start >= 0 && word.duration > 0 && !!word.text.trim()));

const comparable = (text: string): string => text.normalize('NFKC').toLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, '');
const rowTexts = (rows: ParsedLyric[]): Set<string> => new Set(rows.map((row) => comparable(row.text)).filter(Boolean));

/** 补全轨道也必须属于同一首歌词，拒绝用另一首的逐字或翻译替换。 */
export const lyricsHaveSameText = (left: ParsedLyric[], right: ParsedLyric[]): boolean => {
  const first = rowTexts(left), second = rowTexts(right);
  if (first.size === 0 || second.size === 0) return false;
  const common = [...first].filter((text) => second.has(text)).length;
  return common / Math.max(first.size, second.size) >= 0.6
    || comparable(left.map((row) => row.text).join('')) === comparable(right.map((row) => row.text).join(''));
};

const score = (rows: ParsedLyric[]): number =>
  (rows.some((row) => !row.untimed) ? 4 : 0) + (hasRealTimedWords(rows) ? 8 : 0)
  + (rows.some((row) => row.translation) ? 2 : 0)
  + (rows.some((row) => row.romanization || row.pronunciation) ? 1 : 0);

export const isLyricImprovement = (existing?: string, candidate?: string, duration = 0): boolean => {
  if (!candidate?.trim() || existing === candidate) return false;
  const candidateRows = parseLyrics(candidate), previousRows = parseLyrics(existing);
  if (candidateRows.length === 0 || analyzeLyricTimeline(candidate, duration).status === 'overrun') return false;
  if (previousRows.length === 0 || analyzeLyricTimeline(existing, duration).status === 'overrun') return true;
  if (previousRows.every((row) => row.untimed) && candidateRows.some((row) => !row.untimed)) return true;
  return lyricsHaveSameText(previousRows, candidateRows) && score(candidateRows) > score(previousRows);
};

export const isUsableSyncedLyric = (lrc: string | undefined, duration = 0): boolean =>
  parseLyrics(lrc).some((row) => !row.untimed)
  && analyzeLyricTimeline(lrc, duration).status !== 'overrun';
