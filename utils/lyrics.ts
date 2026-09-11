export type {
  LyricTimingMode,
  LyricTrackBundle,
  LyricTrackType,
  NormalizedLyrics,
  ParsedLyric,
  ParsedLyricExtra,
  ParsedLyricWord,
} from './lyrics/types';
export {
  DEFAULT_LYRIC_OFFSET_SECONDS,
  LYRIC_DISPLAY_LEAD_SECONDS,
} from './lyrics/types';
export {
  findActiveLyricIndex,
  getLyricLineTime,
  hasExtendedLyrics,
  hasTranslatedLyrics,
  mergeLyricTracks,
  mergeTranslatedLyrics,
  normalizeLyrics,
  parseLyrics,
  supportsTranslatedLyricFallback,
  toLegacyParsedLyrics,
} from './lyrics/publicApi';
export { analyzeLyricTimeline, LYRIC_VERSION_MISMATCH_MESSAGE } from './lyrics/timeline';
export type { LyricTimelineAnalysis } from './lyrics/timeline';
