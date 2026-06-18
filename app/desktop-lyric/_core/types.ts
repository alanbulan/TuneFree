import type { ParsedLyric } from '../../../src/core/utils/lyrics';

export interface DesktopLyricSong {
  id: string | number;
  name: string;
  artist: string;
  source: string;
  pic?: string;
  lrc?: string;
}

export interface LyricUpdateEvent {
  song: DesktopLyricSong | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate?: number;
  lyricOffsetSeconds?: number;
  sentAt?: number;
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
  isPlaying: boolean;
}

export type DesktopLyricCommand = 'play-pause' | 'prev' | 'next' | 'toggle-lock' | 'adjust-lyric-size' | 'close-lyric';
