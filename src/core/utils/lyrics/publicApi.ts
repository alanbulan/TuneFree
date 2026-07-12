import { parseLyricDocument, parseTrackLines } from './documentParser';
import { buildPlainRows, buildRowsFromPrimaryAndTracks, inferLegacyAutoTrackType } from './trackMatcher';
import {
  DEFAULT_LYRIC_OFFSET_SECONDS, EXTENDED_TRACK_MATCH_TOLERANCE_SECONDS,
  KARAOKE_TRACK_MATCH_TOLERANCE_SECONDS, LEGACY_TRACK_MATCH_TOLERANCE_SECONDS,
  TRANSLATED_FALLBACK_SOURCES,
} from './types';
import type {
  ExtensionTrack, LyricTimingMode, LyricTrackBundle, LyricTrackType,
  NormalizedLyrics, ParsedLyric, RawLyricLine,
} from './types';

export const normalizeLyrics = (bundle: LyricTrackBundle): NormalizedLyrics => {
  const primaryLines = parseTrackLines(bundle.main, 'main');
  const tracks: ExtensionTrack[] = [];
  const addTrack = (type: Exclude<LyricTrackType, 'main'>, raw?: string) => {
    const lines = parseTrackLines(raw, type);
    if (lines.length === 0) return;
    tracks.push({ type, lines, toleranceSeconds: type === 'karaoke'
      ? KARAOKE_TRACK_MATCH_TOLERANCE_SECONDS : EXTENDED_TRACK_MATCH_TOLERANCE_SECONDS });
  };
  addTrack('translation', bundle.translation);
  addTrack('romanization', bundle.romanization);
  addTrack('pronunciation', bundle.pronunciation);
  addTrack('karaoke', bundle.karaoke);
  return { lines: buildRowsFromPrimaryAndTracks(primaryLines, tracks),
    raw: bundle, source: bundle.source, offsetSeconds: 0 };
};

export const toLegacyParsedLyrics = (lyrics: NormalizedLyrics): ParsedLyric[] => lyrics.lines;

export const mergeLyricTracks = (bundle: LyricTrackBundle): string => {
  const entries: Array<[LyricTrackType, string | undefined]> = [
    ['main', bundle.main], ['translation', bundle.translation],
    ['romanization', bundle.romanization], ['pronunciation', bundle.pronunciation],
    ['karaoke', bundle.karaoke],
  ];
  const nonEmpty = entries.map(([type, value]) => [type, value?.trim() || ''] as const)
    .filter(([, value]) => value.length > 0);
  if (nonEmpty.length === 0) return '';
  if (nonEmpty.length === 1 && nonEmpty[0][0] === 'main') return nonEmpty[0][1];
  return nonEmpty.map(([type, value]) => `[tunefree:${type}]\n${value}`).join('\n\n');
};
export const mergeTranslatedLyrics = (main: string, trans: string): string =>
  mergeLyricTracks({ main, translation: trans });

export const parseLyrics = (lrc?: string): ParsedLyric[] => {
  const document = parseLyricDocument(lrc);
  if (document.blocks.length === 0) return buildPlainRows(document.plainLines);
  const primaryLines: RawLyricLine[] = [];
  const tracks: ExtensionTrack[] = [];
  let autoExtensionIndex = 0;
  document.blocks.forEach((block, index) => {
    let type = block.type;
    if (type === 'auto') type = index === 0 ? 'main' : inferLegacyAutoTrackType(autoExtensionIndex++);
    if (type === 'main') { primaryLines.push(...block.lines); return; }
    tracks.push({ type, lines: block.lines, toleranceSeconds: type === 'karaoke'
      ? KARAOKE_TRACK_MATCH_TOLERANCE_SECONDS
      : block.type === 'auto' ? LEGACY_TRACK_MATCH_TOLERANCE_SECONDS
      : EXTENDED_TRACK_MATCH_TOLERANCE_SECONDS });
  });
  const rows = buildRowsFromPrimaryAndTracks(primaryLines, tracks);
  return rows.length > 0 ? rows : buildPlainRows(document.plainLines);
};

export const getLyricLineTime = (
  row: ParsedLyric,
  timingMode: LyricTimingMode = 'line',
): number => timingMode === 'karaoke' && Number.isFinite(row.karaokeTime)
  ? row.karaokeTime as number : row.time;

export const findActiveLyricIndex = (
  rows: ParsedLyric[],
  currentTime: number,
  lyricOffsetSeconds = DEFAULT_LYRIC_OFFSET_SECONDS,
  timingMode: LyricTimingMode = 'line',
): number => {
  if (rows.length === 0) return -1;
  const targetTime = currentTime + lyricOffsetSeconds;
  if (timingMode === 'karaoke') {
    let activeIndex = -1;
    let activeTime = Number.NEGATIVE_INFINITY;
    rows.forEach((row, index) => {
      const rowTime = getLyricLineTime(row, timingMode);
      if (rowTime <= targetTime && rowTime >= activeTime) {
        activeIndex = index; activeTime = rowTime;
      }
    });
    return activeIndex;
  }
  let low = 0;
  let high = rows.length - 1;
  let activeIndex = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (getLyricLineTime(rows[mid], timingMode) <= targetTime) {
      activeIndex = mid; low = mid + 1;
    } else high = mid - 1;
  }
  return activeIndex;
};

export const hasTranslatedLyrics = (rows: ParsedLyric[]): boolean =>
  rows.some((row) => !!row.translation || (row.translations?.length || 0) > 0);
export const hasExtendedLyrics = (rows: ParsedLyric[]): boolean => rows.some((row) =>
  !!row.translation || !!row.romanization || !!row.pronunciation || (row.extra?.length || 0) > 0);
export const supportsTranslatedLyricFallback = (source?: string): boolean =>
  !!source && TRANSLATED_FALLBACK_SOURCES.has(source);
