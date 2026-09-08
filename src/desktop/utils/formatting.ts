import type { ParsedLyric } from '../../core/utils/lyrics';
import type { CSSProperties } from 'react';

const noteGlyphs = ['♪', '♫', '♩', '♬', '♭', '♯'];

export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
};

export interface ScoreNote {
  glyph: string;
  top: number;
  left: number;
  delay: number;
  duration: number;
  drift: number;
}

export const buildScoreNotes = (text: string, currentTime: number): ScoreNote[] => {
  const chars = Array.from(text.replace(/\s+/g, ''));
  const source = chars.length > 0 ? chars : Array.from('TuneFree');
  const count = Math.min(18, Math.max(10, source.length + 4));

  return Array.from({ length: count }, (_, index) => {
    const char = source[index % source.length] || '♪';
    const code = char.codePointAt(0) || 0;
    const duration = 3.4 + (code % 7) * 0.18;

    return {
      glyph: noteGlyphs[(code + index) % noteGlyphs.length],
      top: 18 + ((code + index * 13) % 62),
      left: count === 1 ? 50 : 6 + index * (88 / (count - 1)),
      delay: -((currentTime * 0.38 + index * 0.23) % duration),
      duration,
      drift: ((code % 9) - 4) * 2,
    };
  });
};

export const getLyricExtensionLines = (row: ParsedLyric): string[] => [
  row.romanization,
  row.pronunciation,
  row.translation,
  ...(row.extra || []).map((item) => item.text),
].filter((line): line is string => !!line?.trim() && line.trim() !== '//');

export type NoteStyle = CSSProperties & {
  '--note-delay'?: string;
  '--note-duration'?: string;
  '--note-drift'?: string;
};

export type OffsetStyle = CSSProperties & {
  '--lyric-offset'?: number;
};

export type CoverPanelStyle = CSSProperties & {
  '--full-cover-bg'?: string;
};

export { noteGlyphs };
