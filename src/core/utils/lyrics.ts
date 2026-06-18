export type ParsedLyric = {
  time: number;
  text: string;
  translation?: string;
};

export const LYRIC_DISPLAY_LEAD_SECONDS = 0.35;

const timeTagPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const metadataPattern = /^\s*\[(ar|al|ti|by|length|re|ve|kana):.*\]\s*$/i;
const offsetPattern = /^\s*\[offset:([+-]?\d+)\]\s*$/i;
const TRANSLATED_FALLBACK_SOURCES = new Set(['netease', 'qq']);
const BLOCK_RESET_TOLERANCE_SECONDS = 2;
const TRANSLATION_MATCH_TOLERANCE_SECONDS = 1.25;

type RawLyricLine = {
  time: number;
  text: string;
  order: number;
  key: string;
};

type LyricDocument = {
  blocks: RawLyricLine[][];
  plainLines: string[];
};

const parseTimeMatch = (match: RegExpMatchArray): number => {
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = Number((match[3] || '0').padEnd(3, '0').slice(0, 3));
  return minutes * 60 + seconds + fraction / 1000;
};

const normalizeLyricText = (line: string): string =>
  line.replace(timeTagPattern, '').replace(/\s+/g, ' ').trim();

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

const parseLyricDocument = (lrc?: string): LyricDocument => {
  const blocks: RawLyricLine[][] = [[]];
  const plainLines: string[] = [];
  let order = 0;
  let offsetSeconds = 0;
  let previousLineTime: number | null = null;

  if (!lrc?.trim()) return { blocks: [], plainLines };

  for (const rawLine of lrc.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

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
      blocks.push([]);
    }
    previousLineTime = firstTime;

    const block = blocks[blocks.length - 1];
    for (const match of matches) {
      const time = Math.max(0, parseTimeMatch(match) + offsetSeconds);
      block.push({ time, text, order, key: getTimeKey(time) });
    }
    order += 1;
  }

  return {
    blocks: blocks.filter((block) => block.length > 0),
    plainLines,
  };
};

const groupTimedLines = (lines: RawLyricLine[]) => {
  const groups: Array<{
    key: string;
    time: number;
    order: number;
    values: string[];
  }> = [];
  const groupMap = new Map<string, (typeof groups)[number]>();

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

const setRowTranslation = (row: ParsedLyric, translations: string[]) => {
  const values = translations.filter((text) => text && text !== row.text);
  if (values.length === 0) return;

  row.translation = row.translation
    ? [row.translation, ...values.filter((text) => !row.translation?.includes(text))].join(' / ')
    : values.join(' / ');
};

const buildRowsFromPrimaryAndTranslations = (
  primaryLines: RawLyricLine[],
  translationLines: RawLyricLine[] = [],
): ParsedLyric[] => {
  const primaryGroups = groupTimedLines(primaryLines);
  const translationGroups = groupTimedLines(translationLines);
  const translationByKey = new Map(translationGroups.map((group) => [group.key, group]));
  const usedTranslationKeys = new Set<string>();

  const rows = primaryGroups.map((group) => {
    const row: ParsedLyric = { time: group.time, text: group.values[0] || '' };
    setRowTranslation(row, group.values.slice(1));

    const exactTranslation = translationByKey.get(group.key);
    if (exactTranslation) {
      setRowTranslation(row, exactTranslation.values);
      usedTranslationKeys.add(exactTranslation.key);
    }

    return row;
  }).filter((row) => row.text);

  rows.forEach((row, rowIndex) => {
    if (row.translation) return;

    let bestGroup: (typeof translationGroups)[number] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const primaryOrder = primaryGroups[rowIndex]?.order || 0;

    for (const group of translationGroups) {
      if (usedTranslationKeys.has(group.key)) continue;

      const timeDiff = Math.abs(group.time - row.time);
      if (timeDiff > TRANSLATION_MATCH_TOLERANCE_SECONDS) continue;

      const score = timeDiff + Math.abs(group.order - primaryOrder) * 0.02;
      if (score < bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }

    if (bestGroup) {
      setRowTranslation(row, bestGroup.values);
      usedTranslationKeys.add(bestGroup.key);
    }
  });

  for (const group of translationGroups) {
    if (usedTranslationKeys.has(group.key)) continue;

    const text = group.values[0] || '';
    if (!text) continue;

    const row: ParsedLyric = { time: group.time, text };
    setRowTranslation(row, group.values.slice(1));
    rows.push(row);
  }

  return rows.sort((a, b) => a.time - b.time);
};

const buildPlainRows = (plainLines: string[]): ParsedLyric[] =>
  plainLines.slice(0, 80).map((text, index) => ({
    time: index * 4,
    text,
  }));

export const mergeTranslatedLyrics = (main: string, trans: string): string => {
  if (!main?.trim()) return trans || '';
  if (!trans?.trim()) return main || '';

  const mainDocument = parseLyricDocument(main);
  const translationDocument = parseLyricDocument(trans);
  const mainLines = mainDocument.blocks.flat();
  const translationLines = translationDocument.blocks.flat();

  if (mainLines.length === 0 || translationLines.length === 0) {
    return `${main}\n${trans}`;
  }

  const rows = buildRowsFromPrimaryAndTranslations(mainLines, translationLines);
  return rows.flatMap((row) => {
    const timestamp = formatLyricTime(row.time);
    const lines = [`[${timestamp}]${row.text}`];
    if (row.translation) lines.push(`[${timestamp}]${row.translation}`);
    return lines;
  }).join('\n');
};

export const parseLyrics = (lrc?: string): ParsedLyric[] => {
  const document = parseLyricDocument(lrc);
  if (document.blocks.length === 0) return buildPlainRows(document.plainLines);

  const [primaryBlock, ...translationBlocks] = document.blocks;
  if (!primaryBlock) return buildPlainRows(document.plainLines);

  return buildRowsFromPrimaryAndTranslations(primaryBlock, translationBlocks.flat());
};

export const findActiveLyricIndex = (
  rows: ParsedLyric[],
  currentTime: number,
  leadSeconds = LYRIC_DISPLAY_LEAD_SECONDS,
): number => {
  if (rows.length === 0) return -1;

  const targetTime = currentTime + leadSeconds;
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
  rows.some((row) => !!row.translation);

export const supportsTranslatedLyricFallback = (source?: string): boolean =>
  !!source && TRANSLATED_FALLBACK_SOURCES.has(source);
