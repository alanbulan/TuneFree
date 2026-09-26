import type { ParsedLyric } from '../../core/utils/lyrics';
import type { CSSProperties } from 'react';

export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
};

export const getLyricExtensionLines = (row: ParsedLyric): string[] => [
  row.romanization,
  row.pronunciation,
  row.translation,
  ...(row.extra || []).map((item) => item.text),
].filter((line): line is string => !!line?.trim() && line.trim() !== '//');

export type OffsetStyle = CSSProperties & {
  '--lyric-offset'?: number;
};

export type CoverPanelStyle = CSSProperties & {
  '--full-cover-bg'?: string;
};
