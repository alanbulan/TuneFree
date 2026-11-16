import type {
  LyricBlock, LyricDocument, LyricTrackType,
  RawLyricLine, TimedLineGroup,
} from './types';
import { parseTimedContent, shiftWords } from './wordParser';

const timeTagPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const metadataPattern = /^\s*\[(ar|al|ti|by|length|re|ve|kana):.*\]\s*$/i;
const offsetPattern = /^\s*\[offset:([+-]?\d+)\]\s*$/i;
const trackMarkerPattern = /^\s*\[(?:tunefree:)?([a-z_-]+)\]\s*$/i;
const durationLinePattern = /^\s*\[(\d+),(\d+)\](.*)$/;
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
  krc: 'karaoke', mrc: 'karaoke', klyric: 'karaoke',
};

const parseTimeMatch = (match: RegExpMatchArray): number => {
  const fraction = Number((match[3] || '0').padEnd(3, '0').slice(0, 3));
  return Number(match[1]) * 60 + Number(match[2]) + fraction / 1000;
};
const isThirdPartyWatermarkSentinel = (match: RegExpMatchArray, text: string): boolean =>
  match[1] === '999' && THIRD_PARTY_WATERMARKS.has(text);
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
  const xmlContent = lrc.match(/\bLyricContent="([\s\S]*?)"\s*\/?>/)?.[1];
  const input = (xmlContent ?? lrc).replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(?:13|10);/g, '\n');
  const sourceLines = input.split(/\r?\n/);
  // 无歌词的 marker 前置 offset 为公共值；已有歌词或 marker 内的 offset 只属于该轨。
  // 预扫描使轨道末尾的 offset 也能同步移动整轨及其真实逐字时间。
  let preambleHasContent = false;
  let inheritedOffset = 0;
  const blockOffsets = sourceLines.reduce<number[]>((offsets, line) => {
    if (getTrackTypeFromMarker(line)) {
      if (offsets.length === 1) inheritedOffset = preambleHasContent ? 0 : offsets[0];
      offsets.push(inheritedOffset);
    }
    const match = line.match(offsetPattern);
    if (match) offsets[offsets.length - 1] = Number(match[1]) / 1000;
    else if (offsets.length === 1 && line.trim() && !metadataPattern.test(line)) preambleHasContent = true;
    return offsets;
  }, [0]);
  let rawBlockIndex = 0;
  offsetSeconds = blockOffsets[0] || 0;
  for (const rawLine of sourceLines) {
    const line = rawLine.trim();
    if (!line) continue;
    const markerType = getTrackTypeFromMarker(line);
    if (markerType) {
      const currentBlock = blocks[blocks.length - 1];
      if (currentBlock.lines.length === 0) currentBlock.type = markerType;
      else blocks.push(createBlock(markerType));
      rawBlockIndex += 1;
      offsetSeconds = blockOffsets[rawBlockIndex] || 0; previousLineTime = null; continue;
    }
    const offsetMatch = line.match(offsetPattern);
    if (offsetMatch) continue;
    if (metadataPattern.test(line)) continue;
    const durationLineMatch = line.match(durationLinePattern);
    if (durationLineMatch) {
      const rawTime = Number(durationLineMatch[1]) / 1000;
      const time = Math.max(0, rawTime + offsetSeconds);
      const content = parseTimedContent(durationLineMatch[3] || '', rawTime);
      if (!content.text) continue;
      if (previousLineTime !== null && time + BLOCK_RESET_TOLERANCE_SECONDS < previousLineTime) {
        blocks.push(createBlock('auto'));
      }
      previousLineTime = time;
      blocks[blocks.length - 1].lines.push({ time, text: content.text,
        words: shiftWords(content.words, offsetSeconds), order, key: getTimeKey(time) });
      order += 1; continue;
    }
    const matches = Array.from(line.matchAll(timeTagPattern));
    const firstLineTime = matches.length > 0 ? parseTimeMatch(matches[0]) : 0;
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
        words: shiftWords(content.words, parseTimeMatch(match) - firstLineTime + offsetSeconds),
        order, key: getTimeKey(time) });
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
