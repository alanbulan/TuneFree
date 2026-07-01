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
const inlineWordTimePattern = /<((?:(?:\d{1,3}:)?\d{1,2}[.:]\d{1,3}|\d+)(?:,\d+)?)(?:,[^>]*)?>/g;
const durationLinePattern = /^\s*\[(\d+),(\d+)\](.*)$/;
const durationTimingMarkerPattern = /\((\d+),(\d+)(?:,[^)]*)?\)/g;
const durationWordPattern = /\((\d+),(\d+)(?:,[^)]*)?\)([^()]*)/g;
const TRANSLATED_FALLBACK_SOURCES = new Set(['netease', 'qq']);

/**
 * 容差：当某行歌词的时间戳比前一行早出超过此秒数时，认为进入了新的轨道块
 * （即翻译/罗马音等扩展轨道的开始）。取 2 秒是因为正常歌词的时间是单调递增的，
 * 轨道切换时时间会重置从头开始，2 秒足以区分正常递进与轨道重置。
 */
const BLOCK_RESET_TOLERANCE_SECONDS = 2;

/**
 * 容差：将扩展轨道（翻译/罗马音等）的行匹配到主轨道行时允许的最大时间偏差。
 * 取 0.1 秒是因为同一歌曲的不同轨道通常时间戳精确对齐，0.1 秒既能容忍
 * 微小编码差异，又不会错误地将不同行的翻译匹配到一起。
 */
const EXTENDED_TRACK_MATCH_TOLERANCE_SECONDS = 0.1;
const KARAOKE_TRACK_MATCH_TOLERANCE_SECONDS = 1.2;

/**
 * 容差：用于旧版（无显式轨道标记）自动推断轨道的行匹配。
 * 取 0.3 秒比扩展轨道更宽松，因为旧格式中各轨道可能有较大的时间偏差。
 */
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
  words?: ParsedLyricWord[];
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
  words?: ParsedLyricWord[];
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

const parseInlineWordTime = (value: string): { start: number; duration?: number } | null => {
  const commaParts = value.split(',');
  if (commaParts.length >= 2 && /^\d+$/.test(commaParts[0]) && /^\d+$/.test(commaParts[1])) {
    return {
      start: Number(commaParts[0]) / 1000,
      duration: Number(commaParts[1]) / 1000,
    };
  }

  const match = value.match(/^(?:(\d{1,3}):)?(\d{1,2})[.:](\d{1,3})$/);
  if (!match) return null;

  const minutes = Number(match[1] || 0);
  const seconds = Number(match[2]);
  const fraction = Number((match[3] || '0').padEnd(3, '0').slice(0, 3));
  return { start: minutes * 60 + seconds + fraction / 1000 };
};

const cleanWordText = (value: string): string => value.replace(/\s+/g, ' ');

const normalizeWordStart = (start: number, lineStart: number): number => {
  // YRC/QRC 里有的平台给绝对毫秒，有的平台给相对行首毫秒。
  // 只有在词时间明显早于行时间时才按相对值处理。
  if (lineStart > 0 && start + 0.05 < lineStart) return lineStart + start;
  return start;
};

type ParsedTimedContent = {
  text: string;
  words?: ParsedLyricWord[];
};

const parseDurationWords = (
  text: string,
  lineStart: number,
): ParsedLyricWord[] => {
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
      if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) continue;

      words.push({ start, duration, text: rawText });
    }

    return words;
  }

  for (const match of text.matchAll(durationWordPattern)) {
    const rawText = cleanWordText(match[3] || '');
    if (!rawText) continue;

    const start = normalizeWordStart(Number(match[1]) / 1000, lineStart);
    const duration = Number(match[2]) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) continue;

    words.push({ start, duration, text: rawText });
  }

  return words;
};

const parseInlineWords = (text: string): ParsedLyricWord[] => {
  const matches = Array.from(text.matchAll(inlineWordTimePattern));
  if (matches.length === 0) return [];

  const words: ParsedLyricWord[] = [];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const timing = parseInlineWordTime(match[1]);
    if (!timing) continue;

    const contentStart = (match.index || 0) + match[0].length;
    const contentEnd = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    const wordText = cleanWordText(text.slice(contentStart, contentEnd));
    if (!wordText.trim()) continue;

    const nextTiming = index + 1 < matches.length ? parseInlineWordTime(matches[index + 1][1]) : null;
    const duration = timing.duration ?? (nextTiming ? Math.max(0, nextTiming.start - timing.start) : 0);
    if (!Number.isFinite(timing.start) || duration <= 0) continue;

    words.push({
      start: timing.start,
      duration,
      text: wordText,
    });
  }

  return words;
};

const parseTimedContent = (
  text: string,
  lineStart = 0,
): ParsedTimedContent => {
  const durationWords = parseDurationWords(text, lineStart);
  const inlineWords = durationWords.length > 0 ? [] : parseInlineWords(text);
  const words = durationWords.length > 0 ? durationWords : inlineWords;
  const normalizedText = normalizeLyricText(text);

  return {
    text: normalizedText || words.map((word) => word.text).join('').replace(/\s+/g, ' ').trim(),
    words: words.length > 0 ? words : undefined,
  };
};

const normalizeLyricText = (line: string): string =>
  line
    .replace(timeTagPattern, '')
    .replace(durationLinePattern, '$3')
    .replace(durationWordPattern, '$3')
    .replace(durationTimingMarkerPattern, '')
    .replace(inlineWordTimePattern, '')
    .replace(/\s+/g, ' ')
    .trim();

const getTimeKey = (time: number): string => String(Math.round(time * 100));

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

    const durationLineMatch = line.match(durationLinePattern);
    if (durationLineMatch) {
      const time = Math.max(0, Number(durationLineMatch[1]) / 1000 + offsetSeconds);
      const content = parseTimedContent(durationLineMatch[3] || '', time);
      if (!content.text) continue;

      if (
        previousLineTime !== null &&
        time + BLOCK_RESET_TOLERANCE_SECONDS < previousLineTime
      ) {
        blocks.push(createBlock('auto'));
      }
      previousLineTime = time;

      const block = blocks[blocks.length - 1];
      block.lines.push({
        time,
        text: content.text,
        words: content.words,
        order,
        key: getTimeKey(time),
      });
      order += 1;
      continue;
    }

    const matches = Array.from(line.matchAll(timeTagPattern));
    const firstLineTime = matches.length > 0 ? parseTimeMatch(matches[0]) + offsetSeconds : 0;
    const content = parseTimedContent(line, firstLineTime);
    const text = content.text;
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
      block.lines.push({ time, text, words: content.words, order, key: getTimeKey(time) });
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
    if (!group.words && line.words && line.words.length > 0) {
      group.words = line.words;
    }
  }

  return groups.sort((a, b) => a.time - b.time || a.order - b.order);
};

const joinTrackValues = (values: string[]): string => values.join('\n');

const normalizeComparableLyricText = (value: string): string =>
  value.replace(/\s+/g, '').trim();

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
  words?: ParsedLyricWord[],
) => {
  if (type === 'karaoke') {
    if (words && words.length > 0) {
      row.words = words;
      const firstWordStart = words[0]?.start;
      if (Number.isFinite(firstWordStart) && firstWordStart < row.time) {
        row.time = firstWordStart;
      }
    }
    return;
  }

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
      words: group.words,
    }));
  }

  const rows = primaryGroups.map((group) => ({
    time: group.time,
    text: joinTrackValues(group.values),
    mainTexts: group.values.length > 1 ? group.values : undefined,
    words: group.words,
  } satisfies ParsedLyric));

  for (const track of tracks) {
    const groups = groupTimedLines(track.lines);
    const groupByKey = new Map(groups.map((group) => [group.key, group]));
    const usedKeys = new Set<string>();

    rows.forEach((row, index) => {
      const primaryGroup = primaryGroups[index];
      const exactGroup = groupByKey.get(primaryGroup.key);
      if (!exactGroup) return;

      setRowTrack(row, track.type, exactGroup.values, exactGroup.time, exactGroup.words);
      usedKeys.add(exactGroup.key);
    });

    rows.forEach((row, rowIndex) => {
      const primaryGroup = primaryGroups[rowIndex];
      let bestGroup: TimedLineGroup | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      const rowText = normalizeComparableLyricText(row.text);

      for (const group of groups) {
        if (usedKeys.has(group.key)) continue;

        const timeDiff = Math.abs(group.time - row.time);
        if (timeDiff > track.toleranceSeconds) continue;

        const groupText = normalizeComparableLyricText(joinTrackValues(group.values));
        const textBonus = track.type === 'karaoke' && rowText && groupText === rowText ? -0.45 : 0;
        const score = timeDiff + Math.abs(group.order - primaryGroup.order) * 0.02 + textBonus;
        if (score < bestScore) {
          bestScore = score;
          bestGroup = group;
        }
      }

      if (bestGroup) {
        setRowTrack(row, track.type, bestGroup.values, bestGroup.time, bestGroup.words);
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

/**
 * 将多轨歌词包标准化为带时间轴的歌词行数组。
 *
 * 解析主歌词轨道并提取翻译、罗马音、发音、卡拉OK等扩展轨道，
 * 通过时间戳匹配将扩展轨道的内容合并到对应的主轨道行上。
 * 匹配策略：先精确匹配时间键，再在容差范围内寻找最近的时间匹配。
 *
 * @param bundle - 包含各轨道原始 LRC 文本的歌词包
 * @returns 标准化后的歌词对象，包含合并后的行数组、原始包、来源及偏移量
 */
export const normalizeLyrics = (bundle: LyricTrackBundle): NormalizedLyrics => {
  const primaryLines = parseTrackLines(bundle.main, 'main');
  const tracks: ExtensionTrack[] = [];

  const addTrack = (type: Exclude<LyricTrackType, 'main'>, raw?: string) => {
    const lines = parseTrackLines(raw, type);
    if (lines.length === 0) return;
    tracks.push({
      type,
      lines,
      toleranceSeconds: type === 'karaoke'
        ? KARAOKE_TRACK_MATCH_TOLERANCE_SECONDS
        : EXTENDED_TRACK_MATCH_TOLERANCE_SECONDS,
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

/**
 * 将多个歌词轨道合并为单个 LRC 字符串，使用 TuneFree 内部轨道标记格式。
 *
 * 合并算法：遍历所有轨道类型（main、translation、romanization、pronunciation、karaoke），
 * 过滤掉空轨道，为每个非空轨道添加 `[tunefree:类型]` 标记前缀，然后拼接。
 * 如果只有一个 main 轨道且有内容，直接返回其内容不加标记。
 * 标记格式可被 parseLyricDocument 重新解析还原多轨结构。
 *
 * @param bundle - 包含各轨道原始 LRC 文本的歌词包
 * @returns 合并后的单个 LRC 字符串，空输入返回空字符串
 */
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

/**
 * 解析 LRC 格式歌词字符串为带时间轴的歌词行数组。
 *
 * 解析逻辑：
 * 1. 将 LRC 文本按行拆分，识别 `[tunefree:类型]` 轨道标记将文档分块
 * 2. 识别 `[offset:±ms]` 元数据调整时间偏移
 * 3. 对每行提取 `[mm:ss.xx]` 时间标签和歌词文本
 * 4. 根据时间跳跃检测（BLOCK_RESET_TOLERANCE）自动分割轨道块
 * 5. 无显式标记的块按位置推断类型（首块=main，次块=translation，第三块=romanization）
 * 6. 通过时间戳匹配将扩展轨道内容合并到主轨道行
 * 7. 无时间标签的纯文本行按 4 秒间隔生成时间戳
 *
 * @param lrc - LRC 格式的歌词字符串，可选
 * @returns 解析后的歌词行数组，空输入返回空数组
 */
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
      toleranceSeconds: type === 'karaoke'
        ? KARAOKE_TRACK_MATCH_TOLERANCE_SECONDS
        : block.type === 'auto'
        ? LEGACY_TRACK_MATCH_TOLERANCE_SECONDS
        : EXTENDED_TRACK_MATCH_TOLERANCE_SECONDS,
    });
  });

  const rows = buildRowsFromPrimaryAndTracks(primaryLines, tracks);
  return rows.length > 0 ? rows : buildPlainRows(document.plainLines);
};

/**
 * 根据当前播放时间查找应高亮的歌词行索引。
 *
 * 时间匹配策略：使用二分查找在已排序的歌词行数组中找到时间戳
 * 不超过目标时间的最后一行。目标时间 = currentTime + lyricOffsetSeconds，
 * 即考虑用户手动调整的歌词偏移量。返回 -1 表示无歌词行。
 *
 * @param rows - 已按时间排序的歌词行数组
 * @param currentTime - 当前播放位置（秒）
 * @param lyricOffsetSeconds - 歌词偏移量（秒），默认 0
 * @returns 当前应高亮的歌词行索引，无歌词时返回 -1
 */
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
