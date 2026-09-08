import type {
  LyricBlock, LyricDocument, LyricTrackType, ParsedLyricWord,
  RawLyricLine, TimedLineGroup,
} from './types';

const timeTagPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const metadataPattern = /^\s*\[(ar|al|ti|by|length|re|ve|kana):.*\]\s*$/i;
const offsetPattern = /^\s*\[offset:([+-]?\d+)\]\s*$/i;
const trackMarkerPattern = /^\s*\[(?:tunefree:)?([a-z_-]+)\]\s*$/i;
const inlineWordTimePattern = /<((?:(?:\d{1,3}:)?\d{1,2}[.:]\d{1,3}|\d+)(?:,\d+)?)(?:,[^>]*)?>/g;
const durationLinePattern = /^\s*\[(\d+),(\d+)\](.*)$/;
const durationTimingMarkerPattern = /\((\d+),(\d+)(?:,[^)]*)?\)/g;
const durationWordPattern = /\((\d+),(\d+)(?:,[^)]*)?\)([^()]*)/g;
const BLOCK_RESET_TOLERANCE_SECONDS = 2;
const THIRD_PARTY_WATERMARKS = new Set([
  '***歌詞來自第三方***',
  '***歌词来自第三方***',
]);
const TRACK_MARKERS: Record<string, LyricTrackType> = {
  main: 'main', lyric: 'main', lrc: 'main', translation: 'translation',
  translations: 'translation', translated: 'translation', trans: 'translation',
  tlyric: 'translation', tlrc: 'translation', romanization: 'romanization',
  romanisation: 'romanization', romaji: 'romanization', roma: 'romanization',
  rlyric: 'romanization', rlrc: 'romanization', pronunciation: 'pronunciation',
  pron: 'pronunciation', kana: 'pronunciation', karaoke: 'karaoke', yrc: 'karaoke', qrc: 'karaoke',
};

const parseTimeMatch = (match: RegExpMatchArray): number => {
  const fraction = Number((match[3] || '0').padEnd(3, '0').slice(0, 3));
  return Number(match[1]) * 60 + Number(match[2]) + fraction / 1000;
};
const isThirdPartyWatermarkSentinel = (match: RegExpMatchArray, text: string): boolean =>
  match[1] === '999' && THIRD_PARTY_WATERMARKS.has(text);
const parseInlineWordTime = (value: string): { start: number; duration?: number } | null => {
  const commaParts = value.split(',');
  if (commaParts.length >= 2 && /^\d+$/.test(commaParts[0]) && /^\d+$/.test(commaParts[1])) {
    return { start: Number(commaParts[0]) / 1000, duration: Number(commaParts[1]) / 1000 };
  }
  const match = value.match(/^(?:(\d{1,3}):)?(\d{1,2})[.:](\d{1,3})$/);
  if (!match) return null;
  const fraction = Number((match[3] || '0').padEnd(3, '0').slice(0, 3));
  return { start: Number(match[1] || 0) * 60 + Number(match[2]) + fraction / 1000 };
};
const cleanWordText = (value: string): string => value.replace(/\s+/g, ' ');
const normalizeWordStart = (start: number, lineStart: number): number =>
  lineStart > 0 && start + 0.05 < lineStart ? lineStart + start : start;

const parseDurationWords = (text: string, lineStart: number): ParsedLyricWord[] => {
  const words: ParsedLyricWord[] = [];
  const firstTimingIndex = text.search(durationTimingMarkerPattern);
  if (firstTimingIndex > 0 && text.slice(0, firstTimingIndex).trim()) {
    let cursor = 0;
    for (const match of text.matchAll(durationTimingMarkerPattern)) {
      const markerIndex = match.index || 0;
      const rawText = cleanWordText(text.slice(cursor, markerIndex));
      cursor = markerIndex + match[0].length;
      if (!rawText) continue;
      const start = normalizeWordStart(Number(match[1]) / 1000, lineStart);
      const duration = Number(match[2]) / 1000;
      if (Number.isFinite(start) && Number.isFinite(duration) && duration >= 0) {
        words.push({ start, duration, text: rawText });
      }
    }
    return words;
  }
  for (const match of text.matchAll(durationWordPattern)) {
    const rawText = cleanWordText(match[3] || '');
    if (!rawText) continue;
    const start = normalizeWordStart(Number(match[1]) / 1000, lineStart);
    const duration = Number(match[2]) / 1000;
    if (Number.isFinite(start) && Number.isFinite(duration) && duration >= 0) {
      words.push({ start, duration, text: rawText });
    }
  }
  return words;
};
const parseInlineWords = (text: string): ParsedLyricWord[] => {
  const matches = Array.from(text.matchAll(inlineWordTimePattern));
  const words: ParsedLyricWord[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const timing = parseInlineWordTime(match[1]);
    if (!timing) continue;
    const contentStart = (match.index || 0) + match[0].length;
    const contentEnd = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    const wordText = cleanWordText(text.slice(contentStart, contentEnd));
    if (!wordText.trim()) continue;
    const nextTiming = index + 1 < matches.length ? parseInlineWordTime(matches[index + 1][1]) : null;
    const duration = timing.duration ?? (nextTiming ? Math.max(0, nextTiming.start - timing.start) : 0);
    if (Number.isFinite(timing.start) && duration > 0) words.push({ start: timing.start, duration, text: wordText });
  }
  return words;
};
const normalizeLyricText = (line: string): string => line
  .replace(timeTagPattern, '').replace(durationLinePattern, '$3')
  .replace(durationWordPattern, '$3').replace(durationTimingMarkerPattern, '')
  .replace(inlineWordTimePattern, '').replace(/\s+/g, ' ').trim();
const parseTimedContent = (text: string, lineStart = 0) => {
  const durationWords = parseDurationWords(text, lineStart);
  const words = durationWords.length > 0 ? durationWords : parseInlineWords(text);
  const normalizedText = normalizeLyricText(text);
  return { text: normalizedText || words.map((word) => word.text).join('').replace(/\s+/g, ' ').trim(),
    words: words.length > 0 ? words : undefined };
};
const getTimeKey = (time: number): string => String(Math.round(time * 100));
export const pushUnique = (values: string[], value: string): void => {
  if (value && !values.includes(value)) values.push(value);
};
const getTrackTypeFromMarker = (line: string): LyricTrackType | null => {
  const marker = line.match(trackMarkerPattern)?.[1]?.toLowerCase();
  return marker && Object.prototype.hasOwnProperty.call(TRACK_MARKERS, marker) ? TRACK_MARKERS[marker] : null;
};
const createBlock = (type: LyricTrackType | 'auto'): LyricBlock => ({ type, lines: [] });

export const parseLyricDocument = (
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
      if (currentBlock.lines.length === 0) currentBlock.type = markerType;
      else blocks.push(createBlock(markerType));
      offsetSeconds = 0; previousLineTime = null; continue;
    }
    const offsetMatch = line.match(offsetPattern);
    if (offsetMatch) { offsetSeconds = Number(offsetMatch[1]) / 1000; continue; }
    if (metadataPattern.test(line)) continue;
    const durationLineMatch = line.match(durationLinePattern);
    if (durationLineMatch) {
      const time = Math.max(0, Number(durationLineMatch[1]) / 1000 + offsetSeconds);
      const content = parseTimedContent(durationLineMatch[3] || '', time);
      if (!content.text) continue;
      if (previousLineTime !== null && time + BLOCK_RESET_TOLERANCE_SECONDS < previousLineTime) {
        blocks.push(createBlock('auto'));
      }
      previousLineTime = time;
      blocks[blocks.length - 1].lines.push({ time, text: content.text,
        words: content.words, order, key: getTimeKey(time) });
      order += 1; continue;
    }
    const matches = Array.from(line.matchAll(timeTagPattern));
    const firstLineTime = matches.length > 0 ? parseTimeMatch(matches[0]) + offsetSeconds : 0;
    const content = parseTimedContent(line, firstLineTime);
    if (!content.text) continue;
    if (matches.length === 0) { plainLines.push(content.text); continue; }
    const timedMatches = matches.filter((match) => !isThirdPartyWatermarkSentinel(match, content.text));
    if (timedMatches.length === 0) continue;
    const firstTime = parseTimeMatch(timedMatches[0]) + offsetSeconds;
    if (previousLineTime !== null && firstTime + BLOCK_RESET_TOLERANCE_SECONDS < previousLineTime) {
      blocks.push(createBlock('auto'));
    }
    previousLineTime = firstTime;
    for (const match of timedMatches) {
      const time = Math.max(0, parseTimeMatch(match) + offsetSeconds);
      blocks[blocks.length - 1].lines.push({ time, text: content.text,
        words: content.words, order, key: getTimeKey(time) });
    }
    order += 1;
  }
  return { blocks: blocks.filter((block) => block.lines.length > 0), plainLines, offsetSeconds };
};

export const parseTrackLines = (raw: string | undefined, type: LyricTrackType): RawLyricLine[] =>
  parseLyricDocument(raw, type).blocks.flatMap((block) => block.lines);
export const groupTimedLines = (lines: RawLyricLine[]): TimedLineGroup[] => {
  const groups: TimedLineGroup[] = [];
  const groupMap = new Map<string, TimedLineGroup>();
  for (const line of [...lines].sort((a, b) => a.time - b.time || a.order - b.order)) {
    let group = groupMap.get(line.key);
    if (!group) {
      group = { key: line.key, time: line.time, order: line.order, values: [] };
      groupMap.set(line.key, group); groups.push(group);
    }
    pushUnique(group.values, line.text);
    if (!group.words && line.words?.length) group.words = line.words;
  }
  return groups.sort((a, b) => a.time - b.time || a.order - b.order);
};
export const joinTrackValues = (values: string[]): string => values.join('\n');
