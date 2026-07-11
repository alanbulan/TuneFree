export type LyricTrackType = 'main' | 'translation' | 'romanization' | 'pronunciation' | 'karaoke';
export type ParsedLyricExtra = {
  type: Exclude<LyricTrackType, 'main'> | 'main';
  text: string;
  time?: number;
};
export type ParsedLyricWord = { start: number; duration: number; text: string };
export type ParsedLyric = {
  time: number;
  karaokeTime?: number;
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
export type LyricTimingMode = 'line' | 'karaoke';

export interface RawLyricLine {
  time: number;
  text: string;
  order: number;
  key: string;
  words?: ParsedLyricWord[];
}
export interface LyricBlock {
  type: LyricTrackType | 'auto';
  lines: RawLyricLine[];
}
export interface LyricDocument {
  blocks: LyricBlock[];
  plainLines: string[];
  offsetSeconds: number;
}
export interface TimedLineGroup {
  key: string;
  time: number;
  order: number;
  values: string[];
  words?: ParsedLyricWord[];
}
export interface ExtensionTrack {
  type: Exclude<LyricTrackType, 'main'>;
  lines: RawLyricLine[];
  toleranceSeconds: number;
}

export const DEFAULT_LYRIC_OFFSET_SECONDS = 0;
export const LYRIC_DISPLAY_LEAD_SECONDS = DEFAULT_LYRIC_OFFSET_SECONDS;
export const EXTENDED_TRACK_MATCH_TOLERANCE_SECONDS = 0.1;
export const KARAOKE_TRACK_MATCH_TOLERANCE_SECONDS = 1.2;
export const KARAOKE_TEXT_MATCH_TOLERANCE_SECONDS = 8;
export const LEGACY_TRACK_MATCH_TOLERANCE_SECONDS = 0.3;
export const TRANSLATED_FALLBACK_SOURCES = new Set(['netease', 'qq']);
