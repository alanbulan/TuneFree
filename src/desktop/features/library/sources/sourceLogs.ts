/**
 * 音源运行日志的解析与归并。
 *
 * 沙箱里的日志形如 `[标签] 内容`（标签由 workerHost 写入：请求失败 / 调用失败 /
 * 已加载 / 事件 / log …）。原始形态有两个问题：
 *
 * 1. **同一次失败被记三条**：底层请求失败写一条、脚本 console 写一条、
 *    上层调用失败再写一条。一次解析失败就能刷出三行，几次之后整屏都是它。
 * 2. **没有轻重之分**：全是同一种灰色等宽文本，真正的错误淹没在流水里。
 *
 * 这里按「标签 + 内容」归并并计数，保留首次出现顺序，让 8 行重复变成
 * 3 行 ×N；同时给出严重级别，交给界面着色。
 */

export type SourceLogTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface SourceLogEntry {
  /** 首次出现的时间 `HH:MM:SS`；老日志没有时间戳时为空。 */
  time: string;
  tag: string;
  message: string;
  tone: SourceLogTone;
  /** 该条日志出现的次数；>1 时界面显示 ×N。 */
  count: number;
}

const WARNING_TAGS = new Set(['warn', 'warning', '警告']);
const DANGER_TAGS = new Set(['error', '失败', '请求失败', '调用失败', '错误']);
const SUCCESS_TAGS = new Set(['调用成功', '已加载', '事件']);

const toneOf = (tag: string): SourceLogTone => {
  const normalized = tag.toLowerCase();
  if (DANGER_TAGS.has(tag) || normalized === 'error') return 'danger';
  if (WARNING_TAGS.has(tag) || WARNING_TAGS.has(normalized)) return 'warning';
  if (SUCCESS_TAGS.has(tag)) return 'success';
  return 'neutral';
};

const TAG_PATTERN = /^\[([^\]]*)\]\s*([\s\S]*)$/;
const TIME_PATTERN = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/;

/**
 * 拆出 `[时间] [标签] 内容`。
 *
 * 时间与标签都是可选的：沙箱写入的行一定带时间，但用户脚本自己 console 的
 * 内容、以及历史快照里的旧日志可能没有，两种情况都要能正常显示。
 */
export const splitSourceLog = (raw: string): { time: string; tag: string; message: string } => {
  let rest = raw.trim();
  let time = '';
  const timeMatch = TIME_PATTERN.exec(rest);
  if (timeMatch) {
    time = timeMatch[1];
    rest = rest.slice(timeMatch[0].length);
  }
  const tagMatch = TAG_PATTERN.exec(rest);
  if (!tagMatch) return { time, tag: '', message: rest };
  return { time, tag: tagMatch[1].trim(), message: tagMatch[2].trim() };
};

/** 按「标签 + 内容」归并计数，保留首次出现顺序与首次出现时间。 */
export const parseSourceLogs = (logs: readonly string[]): SourceLogEntry[] => {
  const entries: SourceLogEntry[] = [];
  const seen = new Map<string, SourceLogEntry>();
  for (const raw of logs) {
    const { time, tag, message } = splitSourceLog(raw);
    if (!tag && !message) continue;
    const key = JSON.stringify([tag, message]);
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const entry: SourceLogEntry = { time, tag, message, tone: toneOf(tag), count: 1 };
    seen.set(key, entry);
    entries.push(entry);
  }
  return entries;
};

/** 归并后的统计：总条数与其中的异常条数，用于折叠标题。 */
export const summarizeSourceLogs = (logs: readonly string[]): {
  entries: SourceLogEntry[];
  total: number;
  problems: number;
} => {
  const entries = parseSourceLogs(logs);
  return {
    entries,
    total: entries.reduce((sum, entry) => sum + entry.count, 0),
    problems: entries
      .filter((entry) => entry.tone === 'danger')
      .reduce((sum, entry) => sum + entry.count, 0),
  };
};
