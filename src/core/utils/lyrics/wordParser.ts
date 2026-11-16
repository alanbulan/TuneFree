import type { ParsedLyricWord } from './types';

export const INLINE_WORD_MARKER = /<((?:\d+,\d+)|(?:(?:\d{1,3}:)?\d{1,2}(?:[.:]\d{1,3})?))(?:,[^>]*)?>/g;
export const DURATION_WORD_MARKER = /\((\d+),(\d+)(?:,[^)]*)?\)/g;
const prefixWordPattern = /\((\d+),(\d+)(?:,[^)]*)?\)([^()]*)/g;
const krcWordPattern = /<(\d+),(\d+),[^>]*>([^<]*)/g;

const cleanText = (text: string): string => text.replace(/\s+/g, ' ');
const makeWord = (start: number, duration: number, text: string): ParsedLyricWord | null =>
  Number.isFinite(start) && Number.isFinite(duration) && duration >= 0 && text
    ? { start, duration, text: cleanText(text) } : null;

const parseInlineTime = (value: string): { start: number; duration?: number } | null => {
  const parts = value.split(',');
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return { start: Number(parts[0]) / 1000, duration: Number(parts[1]) / 1000 };
  }
  const match = value.match(/^(?:(\d{1,3}):)?(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (!match) return null;
  return { start: Number(match[1] || 0) * 60 + Number(match[2])
    + Number((match[3] || '0').padEnd(3, '0')) / 1000 };
};

/** QRC 的时标跟在词后；YRC 的时标在词前；KRC 的三元尖括号始终相对行起点。 */
export const parseDurationWords = (text: string, lineStart: number): ParsedLyricWord[] => {
  const krc = Array.from(text.matchAll(krcWordPattern));
  if (krc.length > 0) return krc.flatMap((match) => {
    const word = makeWord(lineStart + Number(match[1]) / 1000, Number(match[2]) / 1000, match[3]);
    return word ? [word] : [];
  });
  const markers = Array.from(text.matchAll(DURATION_WORD_MARKER));
  if (markers.length === 0) return [];
  const firstIndex = markers[0].index || 0;
  const postfix = firstIndex > 0 && !!text.slice(0, firstIndex).trim();
  // 对整行只决定一次坐标系，不能在长 KRC/QRC 行里逐词猜测后突然切成绝对时间。
  // 原生 QRC/YRC 使用绝对词时标；仅旧版以 0 开始的后置变体采用相对坐标。
  const relative = postfix && Number(markers[0][1]) === 0 && lineStart > 0;
  const startOf = (raw: string) => Number(raw) / 1000 + (relative ? lineStart : 0);
  if (!postfix) return Array.from(text.matchAll(prefixWordPattern)).flatMap((match) => {
    const word = makeWord(startOf(match[1]), Number(match[2]) / 1000, match[3]);
    return word ? [word] : [];
  });
  let cursor = 0;
  return markers.flatMap((match) => {
    const content = text.slice(cursor, match.index);
    cursor = (match.index || 0) + match[0].length;
    const word = makeWord(startOf(match[1]), Number(match[2]) / 1000, content);
    return word ? [word] : [];
  });
};

/** Enhanced LRC 最后一个词没有结束标记时保留为瞬时词；不推测不存在的演唱时长。 */
export const parseInlineWords = (text: string, lineStart: number): ParsedLyricWord[] => {
  const markers = Array.from(text.matchAll(INLINE_WORD_MARKER));
  const words: ParsedLyricWord[] = [];
  const firstIndex = markers[0]?.index || 0;
  if (firstIndex > 0) {
    const prefix = text.slice(0, firstIndex).replace(/\[[^\]]+\]/g, '');
    if (prefix.trim()) words.push({ start: lineStart, duration: 0, text: cleanText(prefix) });
  }
  markers.forEach((marker, index) => {
    const timing = parseInlineTime(marker[1]);
    if (!timing) return;
    const next = markers[index + 1];
    const nextTiming = next ? parseInlineTime(next[1]) : null;
    const content = text.slice((marker.index || 0) + marker[0].length, next?.index ?? text.length);
    const duration = timing.duration ?? (nextTiming ? Math.max(0, nextTiming.start - timing.start) : 0);
    const word = makeWord(timing.start, duration, content);
    if (word?.text.trim()) words.push(word);
  });
  return words;
};

export const parseTimedContent = (text: string, lineStart: number) => {
  const content = text.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '');
  const durationWords = parseDurationWords(content, lineStart);
  const words = durationWords.length > 0 ? durationWords : parseInlineWords(content, lineStart);
  const normalizedText = content
    .replace(prefixWordPattern, '$3').replace(DURATION_WORD_MARKER, '')
    .replace(INLINE_WORD_MARKER, '').replace(/\s+/g, ' ').trim();
  return { text: normalizedText || words.map((word) => word.text).join('').trim(),
    words: words.length > 0 ? words : undefined };
};

export const shiftWords = (words: ParsedLyricWord[] | undefined, seconds: number): ParsedLyricWord[] | undefined =>
  words?.map((word) => {
    const start = Math.max(0, word.start + seconds);
    const duration = word.start + seconds >= 0 ? word.duration
      : Math.max(0, word.start + word.duration + seconds);
    return { ...word, start, duration };
  });
