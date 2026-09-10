import type { ParsedLyric } from './lyrics';

export const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分`);

  return parts.length > 0 ? parts.join(' ') : '刚启动';
};

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * 一行主歌词下面要展示的附加行（音译 / 读音 / 翻译 / 自定义扩展）。
 * '//' 是上游用来占位的空内容，必须过滤掉。
 */
export const getLyricExtensionLines = (row: ParsedLyric): string[] => [
  row.romanization,
  row.pronunciation,
  row.translation,
  ...(row.extra || []).map((item) => item.text),
].filter((line): line is string => !!line?.trim() && line.trim() !== '//');
