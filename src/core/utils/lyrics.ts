export type LyricTrackType = 'main' | 'translation' | 'romanization' | 'pronunciation' | 'karaoke';

export type ParsedLyricExtra = {
  type: Exclude<LyricTrackType, 'main'> | 'main';
  text: string;
  time?: number;
};

export type ParsedLyricWord = {
  start: number;
  duration: number;
  text: string;
};

export type ParsedLyric = {
  time: number;
  text: string;
  mainTexts?: string[];
  translation?: string;
  translations?: string[];
  romanization?: string;
  pronunciation?: string;
  extra?: ParsedLyricExtra[];
  words?: ParsedLyricWord[];
};

export type LyricTrackBundle = {
  main?: string;
  translation?: string;
  romanization?: string;
  pronunciation?: string;
  karaoke?: string;
  source?: string;
};

export type NormalizedLyrics = {
  lines: ParsedLyric[];
  raw: LyricTrackBundle;
  source?: string;
  offsetSeconds: number;
};

export const DEFAULT_LYRIC_OFFSET_SECONDS = 0;
export const LYRIC_DISPLAY_LEAD_SECONDS = DEFAULT_LYRIC_OFFSET_SECONDS;

const timeTagPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const metadataPattern = /^\s*\[(ar|al|ti|by|length|re|ve|kana):.*\]\s*$/i;
const offsetPattern = /^\s*\[offset:([+-]?\d+)\]\s*$/i;
const trackMarkerPattern = /^\s*\[(?:tunefree:)?([a-z_-]+)\]\s*$/i;
const inlineWordTimePattern = /<(?:(?:\d{1,3}:)?\d{1,2}[.:]\d{1,3}|\d+,\d+)(?:,[^>]*)?>/g;
const TRANSLATED_FALLBACK_SOURCES = new Set(['netease', 'qq']);
const BLOCK_RESET_TOLERANCE_SECONDS = 2;
const EXTENDED_TRACK_MATCH_TOLERANCE_SECONDS = 0.1;
const LEGACY_TRACK_MATCH_TOLERANCE_SECONDS = 0.3;

const TRACK_MARKERS: Record<string, LyricTrackType> = {
  main: 'main',
  lyric: 'main',
  lrc: 'main',
  translation: 'translation',
  translations: 'translation',
  translated: 'translation',
  trans: 'translation',
  tlyric: 'translation',
  tlrc: 'translation',
  romanization: 'romanization',
  romanisation: 'romanization',
  romaji: 'romanization',
  roma: 'romanization',
  rlyric: 'romanization',
  rlrc: 'romanization',
  pronunciation: 'pronunciation',
  pron: 'pronunciation',
  kana: 'pronunciation',
  karaoke: 'karaoke',
  yrc: 'karaoke',
  qrc: 'karaoke',
};

type RawLyricLine = {
  time: number;
  text: string;
  order: number;
  key: string;
};

type LyricBlock = {
  type: LyricTrackType | 'auto';
  lines: RawLyricLine[];
};

type LyricDocument = {
  blocks: LyricBlock[];
  plainLines: string[];
  offsetSeconds: number;
};

type TimedLineGroup = {
  key: string;
  time: number;
  order: number;
  values: string[];
};

type ExtensionTrack = {
  type: Exclude<LyricTrackType, 'main'>;
  lines: RawLyricLine[];
  toleranceSeconds: number;
};

const parseTimeMatch = (match: RegExpMatchArray): number => {
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = Number((match[3] || '0').padEnd(3, '0').slice(0, 3));
  return minutes * 60 + seconds + fraction / 1000;
};

const normalizeLyricText = (line: string): string =>
  line
    .replace(timeTagPattern, '')
    .replace(inlineWordTimePattern, '')
    .replace(/\s+/g, ' ')
    .trim();

const getTimeKey = (time: number): string => String(Math.round(time * 100));

const formatLyricTime = (time: number): string => {
  const centiseconds = Math.max(0, Math.round(time * 100));
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor((centiseconds % 6000) / 100);
  const fraction = centiseconds % 100;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`;
};

const pushUnique = (values: string[], value: string) => {
  if (value && !values.includes(value)) values.push(value);
};

const getTrackTypeFromMarker = (line: string): LyricTrackType | null => {
  const marker = line.match(trackMarkerPattern)?.[1]?.toLowerCase();
  return marker ? TRACK_MARKERS[marker] || null : null;
};

const createBlock = (type: LyricTrackType | 'auto'): LyricBlock => ({
  type,
  lines: [],
});

const parseLyricDocument = (
  lrc?: string,
  defaultTrackType: LyricTrackType | 'auto' = 'auto',
): LyricDocument => {
  const blocks: LyricBlock[] = [createBlock(defaultTrackType)];
  const plainLines: string[] = [];
  let order = 0;
  let offsetSeconds = 0;
  let previousLineTime: number | null = null;

  if (!lrc?.trim()) return { blocks: [], plainLines, offsetSeconds };

  for (const rawLine of lrc.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const markerType = getTrackTypeFromMarker(line);
    if (markerType) {
      const currentBlock = blocks[blocks.length - 1];
      if (currentBlock.lines.length === 0) {
        currentBlock.type = markerType;
      } else {
        blocks.push(createBlock(markerType));
      }
      offsetSeconds = 0;
      previousLineTime = null;
      continue;
    }

    const offsetMatch = line.match(offsetPattern);
    if (offsetMatch) {
      offsetSeconds = Number(offsetMatch[1]) / 1000;
      continue;
    }

    if (metadataPattern.test(line)) continue;

    const matches = Array.from(line.matchAll(timeTagPattern));
    const text = normalizeLyricText(line);
    if (!text) continue;

    if (matches.length === 0) {
      plainLines.push(text);
      continue;
    }

    const firstTime = parseTimeMatch(matches[0]) + offsetSeconds;
    if (
      previousLineTime !== null &&
      firstTime + BLOCK_RESET_TOLERANCE_SECONDS < previousLineTime
    ) {
      blocks.push(createBlock('auto'));
    }
    previousLineTime = firstTime;

    const block = blocks[blocks.length - 1];
    for (const match of matches) {
      const time = Math.max(0, parseTimeMatch(match) + offsetSeconds);
      block.lines.push({ time, text, order, key: getTimeKey(time) });
    }
    order += 1;
  }

  return {
    blocks: blocks.filter((block) => block.lines.length > 0),
    plainLines,
    offsetSeconds,
  };
};

const parseTrackLines = (raw: string | undefined, type: LyricTrackType): RawLyricLine[] =>
  parseLyricDocument(raw, type).blocks.flatMap((block) => block.lines);

const groupTimedLines = (lines: RawLyricLine[]): TimedLineGroup[] => {
  const groups: TimedLineGroup[] = [];
  const groupMap = new Map<string, TimedLineGroup>();

  for (const line of [...lines].sort((a, b) => a.time - b.time || a.order - b.order)) {
    let group = groupMap.get(line.key);
    if (!group) {
      group = { key: line.key, time: line.time, order: line.order, values: [] };
      groupMap.set(line.key, group);
      groups.push(group);
    }
    pushUnique(group.values, line.text);
  }

  return groups.sort((a, b) => a.time - b.time || a.order - b.order);
};

const joinTrackValues = (values: string[]): string => values.join('\n');

const getMainTexts = (row: ParsedLyric): string[] =>
  row.mainTexts && row.mainTexts.length > 0 ? row.mainTexts : row.text.split('\n').filter(Boolean);

const filterExtensionValues = (row: ParsedLyric, values: string[]): string[] => {
  const mainTexts = getMainTexts(row);
  return values.filter((text) => text && !mainTexts.includes(text));
};

const setRowTrack = (
  row: ParsedLyric,
  type: Exclude<LyricTrackType, 'main'>,
  values: string[],
  sourceTime?: number,
) => {
  const filtered = filterExtensionValues(row, values);
  if (filtered.length === 0) return;

  if (type === 'translation') {
    const next = [...(row.translations || [])];
    filtered.forEach((text) => pushUnique(next, text));
    row.translations = next;
    row.translation = joinTrackValues(next);
    return;
  }

  if (type === 'romanization') {
    const existing = row.romanization ? row.romanization.split('\n') : [];
    filtered.forEach((text) => pushUnique(existing, text));
    row.romanization = joinTrackValues(existing);
    return;
  }

  if (type === 'pronunciation') {
    const existing = row.pronunciation ? row.pronunciation.split('\n') : [];
    filtered.forEach((text) => pushUnique(existing, text));
    row.pronunciation = joinTrackValues(existing);
    return;
  }

  const extra = [...(row.extra || [])];
  for (const text of filtered) {
    if (!extra.some((item) => item.type === type && item.text === text)) {
      extra.push({ type, text, time: sourceTime });
    }
  }
  row.extra = extra;
};

const buildRowsFromPrimaryAndTracks = (
  primaryLines: RawLyricLine[],
  tracks: ExtensionTrack[] = [],
): ParsedLyric[] => {
  const primaryGroups = groupTimedLines(primaryLines);

  if (primaryGroups.length === 0) {
    const fallbackTrack = tracks.find((track) => track.lines.length > 0);
    if (!fallbackTrack) return [];

    return groupTimedLines(fallbackTrack.lines).map((group) => ({
      time: group.time,
      text: joinTrackValues(group.values),
      mainTexts: group.values.length > 1 ? group.values : undefined,
    }));
  }

  const rows = primaryGroups.map((group) => ({
    time: group.time,
    text: joinTrackValues(group.values),
    mainTexts: group.values.length > 1 ? group.values : undefined,
  } satisfies ParsedLyric));

  for (const track of tracks) {
    const groups = groupTimedLines(track.lines);
    const groupByKey = new Map(groups.map((group) => [group.key, group]));
    const usedKeys = new Set<string>();

    rows.forEach((row, index) => {
      const primaryGroup = primaryGroups[index];
      const exactGroup = groupByKey.get(primaryGroup.key);
      if (!exactGroup) return;

      setRowTrack(row, track.type, exactGroup.values, exactGroup.time);
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
        if (score < bestScore) {
          bestScore = score;
          bestGroup = group;
        }
      }

      if (bestGroup) {
        setRowTrack(row, track.type, bestGroup.values, bestGroup.time);
        usedKeys.add(bestGroup.key);
      }
    });
  }

  return rows.sort((a, b) => a.time - b.time);
};

const buildPlainRows = (plainLines: string[]): ParsedLyric[] =>
  plainLines.slice(0, 80).map((text, index) => ({
    time: index * 4,
    text,
  }));

const inferLegacyAutoTrackType = (autoTrackIndex: number): Exclude<LyricTrackType, 'main'> => {
  if (autoTrackIndex === 2) return 'romanization';
  return 'translation';
};

export const normalizeLyrics = (bundle: LyricTrackBundle): NormalizedLyrics => {
  const primaryLines = parseTrackLines(bundle.main, 'main');
  const tracks: ExtensionTrack[] = [];

  const addTrack = (type: Exclude<LyricTrackType, 'main'>, raw?: string) => {
    const lines = parseTrackLines(raw, type);
    if (lines.length === 0) return;
    tracks.push({
      type,
      lines,
      toleranceSeconds: EXTENDED_TRACK_MATCH_TOLERANCE_SECONDS,
    });
  };

  addTrack('translation', bundle.translation);
  addTrack('romanization', bundle.romanization);
  addTrack('pronunciation', bundle.pronunciation);
  addTrack('karaoke', bundle.karaoke);

  return {
    lines: buildRowsFromPrimaryAndTracks(primaryLines, tracks),
    raw: bundle,
    source: bundle.source,
    offsetSeconds: 0,
  };
};

export const toLegacyParsedLyrics = (lyrics: NormalizedLyrics): ParsedLyric[] => lyrics.lines;

export const mergeLyricTracks = (bundle: LyricTrackBundle): string => {
  const entries: Array<[LyricTrackType, string | undefined]> = [
    ['main', bundle.main],
    ['translation', bundle.translation],
    ['romanization', bundle.romanization],
    ['pronunciation', bundle.pronunciation],
    ['karaoke', bundle.karaoke],
  ];

  const nonEmpty = entries
    .map(([type, value]) => [type, value?.trim() || ''] as const)
    .filter(([, value]) => value.length > 0);

  if (nonEmpty.length === 0) return '';
  if (nonEmpty.length === 1 && nonEmpty[0][0] === 'main') return nonEmpty[0][1];

  return nonEmpty
    .map(([type, value]) => `[tunefree:${type}]\n${value}`)
    .join('\n\n');
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
    if (type === 'auto') {
      type = index === 0 ? 'main' : inferLegacyAutoTrackType(autoExtensionIndex++);
    }

    if (type === 'main') {
      primaryLines.push(...block.lines);
      return;
    }

    tracks.push({
      type,
      lines: block.lines,
      toleranceSeconds: block.type === 'auto'
        ? LEGACY_TRACK_MATCH_TOLERANCE_SECONDS
        : EXTENDED_TRACK_MATCH_TOLERANCE_SECONDS,
    });
  });

  const rows = buildRowsFromPrimaryAndTracks(primaryLines, tracks);
  return rows.length > 0 ? rows : buildPlainRows(document.plainLines);
};

export const findActiveLyricIndex = (
  rows: ParsedLyric[],
  currentTime: number,
  lyricOffsetSeconds = DEFAULT_LYRIC_OFFSET_SECONDS,
): number => {
  if (rows.length === 0) return -1;

  const targetTime = currentTime + lyricOffsetSeconds;
  let low = 0;
  let high = rows.length - 1;
  let activeIndex = 0;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (rows[mid].time <= targetTime) {
      activeIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return activeIndex;
};

export const hasTranslatedLyrics = (rows: ParsedLyric[]): boolean =>
  rows.some((row) => !!row.translation || (row.translations?.length || 0) > 0);

export const hasExtendedLyrics = (rows: ParsedLyric[]): boolean =>
  rows.some((row) =>
    !!row.translation ||
    !!row.romanization ||
    !!row.pronunciation ||
    (row.extra?.length || 0) > 0,
  );

export const supportsTranslatedLyricFallback = (source?: string): boolean =>
  !!source && TRANSLATED_FALLBACK_SOURCES.has(source);
