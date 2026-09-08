import { groupTimedLines, joinTrackValues, pushUnique } from './documentParser';
import { KARAOKE_TEXT_MATCH_TOLERANCE_SECONDS } from './types';
import type {
  ExtensionTrack, LyricTrackType, ParsedLyric, ParsedLyricWord,
  RawLyricLine, TimedLineGroup,
} from './types';

const normalizeComparableLyricText = (value: string): string => value
  .normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').trim();
type KaraokeWordSpan = { wordIndex: number; textStart: number; textEnd: number };
const getBoundedEditDistance = (left: string, right: string, maxDistance: number): number => {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  if (Math.abs(leftChars.length - rightChars.length) > maxDistance) return maxDistance + 1;
  let previous = rightChars.map((_, index) => index + 1);
  previous.unshift(0);
  for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
      const cost = leftChars[leftIndex - 1] === rightChars[rightIndex - 1] ? 0 : 1;
      const distance = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost);
      current.push(distance);
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[rightChars.length];
};

const getMainTexts = (row: ParsedLyric): string[] =>
  row.mainTexts?.length ? row.mainTexts : row.text.split('\n').filter(Boolean);
const filterExtensionValues = (row: ParsedLyric, values: string[]): string[] => {
  const mainTexts = getMainTexts(row);
  return values.filter((text) => text.trim() && text.trim() !== '//' && !mainTexts.includes(text));
};
const setRowTrack = (
  row: ParsedLyric,
  type: Exclude<LyricTrackType, 'main'>,
  values: string[],
  words?: ParsedLyricWord[],
): void => {
  if (type === 'karaoke') {
    if (words?.length) {
      row.words = words;
      if (Number.isFinite(words[0]?.start)) row.karaokeTime = words[0].start;
    }
    return;
  }
  const filtered = filterExtensionValues(row, values);
  if (filtered.length === 0) return;
  if (type === 'translation') {
    const next = [...(row.translations || [])];
    filtered.forEach((text) => pushUnique(next, text));
    row.translations = next; row.translation = joinTrackValues(next);
    if (filtered.length === 1 && words?.length) row.translationWords = words;
    return;
  }
  if (type === 'romanization') {
    const existing = row.romanization ? row.romanization.split('\n') : [];
    filtered.forEach((text) => pushUnique(existing, text));
    row.romanization = joinTrackValues(existing); return;
  }
  const existing = row.pronunciation ? row.pronunciation.split('\n') : [];
  filtered.forEach((text) => pushUnique(existing, text));
  row.pronunciation = joinTrackValues(existing);
};

const attachExactKaraokeText = (
  row: ParsedLyric,
  karaokeText: string,
  karaokeWords: ParsedLyricWord[],
  spans: KaraokeWordSpan[],
  textCursor: number,
): number | null => {
  const rowText = normalizeComparableLyricText(row.text);
  const spanByStart = new Map(spans.map((span, index) => [span.textStart, index]));
  const spanByEnd = new Map(spans.map((span, index) => [span.textEnd, index]));
  let matchStart = karaokeText.indexOf(rowText, textCursor);
  while (matchStart >= 0) {
    const matchEnd = matchStart + rowText.length;
    const firstSpanIndex = spanByStart.get(matchStart);
    const lastSpanIndex = spanByEnd.get(matchEnd);
    if (firstSpanIndex !== undefined && lastSpanIndex !== undefined && lastSpanIndex >= firstSpanIndex) {
      const words = karaokeWords.slice(spans[firstSpanIndex].wordIndex, spans[lastSpanIndex].wordIndex + 1);
      if (Number.isFinite(words[0]?.start) &&
          Math.abs(words[0].start - row.time) <= KARAOKE_TEXT_MATCH_TOLERANCE_SECONDS) {
        setRowTrack(row, 'karaoke', [], words);
        return matchEnd;
      }
    }
    matchStart = karaokeText.indexOf(rowText, matchStart + 1);
  }
  return null;
};

const findFuzzyKaraokeMatch = (
  row: ParsedLyric,
  karaokeText: string,
  karaokeWords: ParsedLyricWord[],
  spans: KaraokeWordSpan[],
  textCursor: number,
): { firstSpanIndex: number; lastSpanIndex: number } | null => {
  const rowText = normalizeComparableLyricText(row.text);
  const rowLength = Array.from(rowText).length;
  if (rowLength < 4) return null;
  const maxDistance = Math.max(1, Math.floor(rowLength * 0.1));
  let best: { firstSpanIndex: number; lastSpanIndex: number; distance: number;
    lengthDiff: number; timeDiff: number } | null = null;
  for (let firstSpanIndex = 0; firstSpanIndex < spans.length; firstSpanIndex += 1) {
    const firstSpan = spans[firstSpanIndex];
    if (firstSpan.textStart < textCursor) continue;
    const timeDiff = Math.abs(karaokeWords[firstSpan.wordIndex].start - row.time);
    if (timeDiff > KARAOKE_TEXT_MATCH_TOLERANCE_SECONDS) continue;
    for (let lastSpanIndex = firstSpanIndex; lastSpanIndex < spans.length; lastSpanIndex += 1) {
      const candidateText = karaokeText.slice(firstSpan.textStart, spans[lastSpanIndex].textEnd);
      const candidateLength = Array.from(candidateText).length;
      if (candidateLength < rowLength - maxDistance) continue;
      if (candidateLength > rowLength + maxDistance) break;
      const distance = getBoundedEditDistance(rowText, candidateText, maxDistance);
      if (distance > maxDistance) continue;
      const lengthDiff = Math.abs(candidateLength - rowLength);
      if (!best || distance < best.distance ||
          (distance === best.distance && lengthDiff < best.lengthDiff) ||
          (distance === best.distance && lengthDiff === best.lengthDiff && timeDiff < best.timeDiff)) {
        best = { firstSpanIndex, lastSpanIndex, distance, lengthDiff, timeDiff };
      }
    }
  }
  return best;
};

const attachKaraokeTrack = (rows: ParsedLyric[], karaokeLines: RawLyricLine[]): void => {
  const karaokeWords: ParsedLyricWord[] = [];
  const spans: KaraokeWordSpan[] = [];
  let karaokeText = '';
  for (const group of groupTimedLines(karaokeLines)) {
    for (const word of group.words || []) {
      const wordIndex = karaokeWords.push(word) - 1;
      const normalizedText = normalizeComparableLyricText(word.text);
      if (!normalizedText) continue;
      const textStart = karaokeText.length;
      karaokeText += normalizedText;
      spans.push({ wordIndex, textStart, textEnd: karaokeText.length });
    }
  }
  if (!karaokeText || spans.length === 0) return;
  let textCursor = 0;
  for (const row of rows) {
    if (!normalizeComparableLyricText(row.text)) continue;
    const exactEnd = attachExactKaraokeText(row, karaokeText, karaokeWords, spans, textCursor);
    if (exactEnd !== null) { textCursor = exactEnd; continue; }
    const best = findFuzzyKaraokeMatch(row, karaokeText, karaokeWords, spans, textCursor);
    if (!best) continue;
    const words = karaokeWords.slice(spans[best.firstSpanIndex].wordIndex,
      spans[best.lastSpanIndex].wordIndex + 1);
    setRowTrack(row, 'karaoke', [], words);
    textCursor = spans[best.lastSpanIndex].textEnd;
  }
};

const attachExtensionTrack = (
  rows: ParsedLyric[],
  primaryGroups: TimedLineGroup[],
  track: ExtensionTrack,
): void => {
  const groups = groupTimedLines(track.lines);
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  const usedKeys = new Set<string>();
  rows.forEach((row, index) => {
    const exactGroup = groupByKey.get(primaryGroups[index].key);
    if (!exactGroup) return;
    setRowTrack(row, track.type, exactGroup.values, exactGroup.words);
    usedKeys.add(exactGroup.key);
  });
  rows.forEach((row, rowIndex) => {
    const primaryGroup = primaryGroups[rowIndex];
    let bestGroup: TimedLineGroup | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const group of groups) {
      if (usedKeys.has(group.key)) continue;
      const timeDiff = Math.abs(group.time - row.time);
      if (timeDiff > track.toleranceSeconds) continue;
      const score = timeDiff + Math.abs(group.order - primaryGroup.order) * 0.02;
      if (score < bestScore) { bestScore = score; bestGroup = group; }
    }
    if (bestGroup) {
      setRowTrack(row, track.type, bestGroup.values, bestGroup.words);
      usedKeys.add(bestGroup.key);
    }
  });
};

export const buildRowsFromPrimaryAndTracks = (
  primaryLines: RawLyricLine[],
  tracks: ExtensionTrack[] = [],
): ParsedLyric[] => {
  const primaryGroups = groupTimedLines(primaryLines);
  if (primaryGroups.length === 0) {
    const fallbackTrack = tracks.find((track) => track.lines.length > 0);
    if (!fallbackTrack) return [];
    return groupTimedLines(fallbackTrack.lines).map((group) => ({
      time: group.time, text: joinTrackValues(group.values),
      mainTexts: group.values.length > 1 ? group.values : undefined, words: group.words,
    }));
  }
  const rows = primaryGroups.map((group) => ({ time: group.time,
    text: joinTrackValues(group.values), mainTexts: group.values.length > 1 ? group.values : undefined,
    words: group.words } satisfies ParsedLyric));
  const karaokeTrack = tracks.find((track) => track.type === 'karaoke');
  if (karaokeTrack) attachKaraokeTrack(rows, karaokeTrack.lines);
  for (const track of tracks) {
    if (track.type !== 'karaoke') attachExtensionTrack(rows, primaryGroups, track);
  }
  return rows.sort((a, b) => a.time - b.time);
};
export const buildPlainRows = (plainLines: string[]): ParsedLyric[] =>
  plainLines.slice(0, 80).map((text, index) => ({ time: index * 4, text }));
export const inferLegacyAutoTrackType = (
  autoTrackIndex: number,
): Exclude<LyricTrackType, 'main'> => autoTrackIndex === 2 ? 'romanization' : 'translation';
