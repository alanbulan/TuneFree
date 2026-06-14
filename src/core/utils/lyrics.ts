export type ParsedLyric = {
  time: number;
  text: string;
  translation?: string;
};

const timeTagPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const metadataPattern = /^\s*\[(ar|al|ti|by|offset|length|re|ve|kana):.*\]\s*$/i;
const TRANSLATED_FALLBACK_SOURCES = new Set(['netease', 'qq']);

type RawLyricLine = {
  time: number;
  text: string;
  order: number;
};

const parseTimeMatch = (match: RegExpMatchArray): number => {
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = Number((match[3] || '0').padEnd(3, '0').slice(0, 3));
  return minutes * 60 + seconds + fraction / 1000;
};

const normalizeLyricText = (line: string): string =>
  line.replace(timeTagPattern, '').replace(/\s+/g, ' ').trim();

export const parseLyrics = (lrc?: string): ParsedLyric[] => {
  if (!lrc?.trim()) return [];

  const raw: RawLyricLine[] = [];
  const plainLines: string[] = [];
  let order = 0;

  for (const rawLine of lrc.split('\n')) {
    const line = rawLine.trim();
    if (!line || metadataPattern.test(line)) continue;

    const matches = Array.from(line.matchAll(timeTagPattern));
    const text = normalizeLyricText(line);
    if (!text) continue;

    if (matches.length === 0) {
      plainLines.push(text);
      continue;
    }

    for (const match of matches) {
      raw.push({ time: parseTimeMatch(match), text, order });
    }
    order += 1;
  }

  raw.sort((a, b) => a.time - b.time || a.order - b.order);

  const rows: ParsedLyric[] = [];
  for (const item of raw) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.time - item.time) < 0.5) {
      if (!last.translation && last.text !== item.text) {
        last.translation = item.text;
      }
      continue;
    }

    rows.push({ time: item.time, text: item.text });
  }

  if (rows.length > 0) return rows;

  return plainLines.slice(0, 80).map((text, index) => ({
    time: index * 4,
    text,
  }));
};

export const findActiveLyricIndex = (
  rows: ParsedLyric[],
  currentTime: number,
): number => {
  if (rows.length === 0) return -1;

  let low = 0;
  let high = rows.length - 1;
  let activeIndex = 0;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (rows[mid].time <= currentTime) {
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
