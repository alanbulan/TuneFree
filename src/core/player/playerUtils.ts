import type { Song } from "../types";
import { hasTranslatedLyrics, parseLyrics, supportsTranslatedLyricFallback } from "../utils/lyrics";

export const PARSED_SONG_CACHE_TTL_MS = 10 * 60 * 1000;
export const MEDIA_ERR_SRC_NOT_SUPPORTED_CODE = 4;

export const createPlaybackSessionId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `playback:${crypto.randomUUID()}`;
  }
  return `playback:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getFiniteAudioDuration = (audio: HTMLAudioElement): number =>
  Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;

export const getMediaErrorSummary = (error: MediaError | null | undefined) => ({
  code: error?.code ?? 0,
  message: error?.message || "",
});

export const isUnsupportedSourcePlayError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return error.name === "NotSupportedError" ||
    String(error.message || "").toLowerCase().includes("source");
};

const getLyricStats = (lrc?: string) => {
  const rows = parseLyrics(lrc);
  return {
    hasRows: rows.length > 0,
    hasTranslation: hasTranslatedLyrics(rows),
    hasTimedWords: rows.some((row) => (row.words?.length || 0) > 1),
  };
};

export const shouldUseLyricCandidate = (existingLrc?: string, candidateLrc?: string): boolean => {
  if (!candidateLrc?.trim() || candidateLrc === existingLrc) return false;
  const candidate = getLyricStats(candidateLrc);
  if (!candidate.hasRows) return false;
  const existing = getLyricStats(existingLrc);
  if (!existing.hasRows) return true;
  if (!existing.hasTimedWords && candidate.hasTimedWords) return true;
  return !existing.hasTranslation && candidate.hasTranslation;
};

const TIMED_WORD_LYRIC_SOURCES = new Set([
  "netease", "qq", "kuwo", "joox", "bilibili", "embeat",
]);

export const shouldFetchBetterLyrics = (song: Pick<Song, "source">, lrc?: string): boolean => {
  const stats = getLyricStats(lrc);
  if (!stats.hasRows) return true;
  const needsTimedWords = TIMED_WORD_LYRIC_SOURCES.has(song.source) && !stats.hasTimedWords;
  const needsTranslation = supportsTranslatedLyricFallback(song.source) && !stats.hasTranslation;
  return needsTimedWords || needsTranslation;
};

export const shouldUseCors = (url: string): boolean =>
  !url.includes("kuwo.cn") && !url.includes("sycdn.kuwo");
