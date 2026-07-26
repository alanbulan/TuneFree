import type { ParsedLyric } from '../../../src/core/utils/lyrics';
import type { LyricDisplayMode } from '../../../src/core/utils/lyricDisplayMode';

export interface DesktopLyricSong {
  id: string | number;
  name: string;
  artist: string;
  source: string;
  pic?: string;
  lrc?: string;
}

export interface DesktopLyricStyleState {
  size: number;
  font: string;
  lock: boolean;
}

export interface DesktopLyricPlayerState {
  song: DesktopLyricSong | null;
  rows: ParsedLyric[];
  activeIndex: number;
  currentLine: ParsedLyric | null;
  currentTime: number;
  lyricOffsetSeconds: number;
  lyricDisplayMode: LyricDisplayMode;
  isPlaying: boolean;
}

export type DesktopLyricCommand = 'play-pause' | 'prev' | 'next' | 'toggle-lock' | 'adjust-lyric-size' | 'close-lyric';
