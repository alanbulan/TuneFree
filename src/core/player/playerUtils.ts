import { getSongKey, type AudioQuality, type Song } from "../types";
import { hasTranslatedLyrics, parseLyrics, supportsTranslatedLyricFallback } from "../utils/lyrics";
import type { ParsedSongCacheEntry } from "./types";
import { hasRealTimedWords, isLyricImprovement } from '../utils/lyrics/quality';

export const PARSED_SONG_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * 「歌曲 + 音质」键。解析缓存键在它后面追加音源配置代数，失败恢复的「只刷新一次」也按它去重，
 * 两处必须由同一个函数生成，否则恢复阶梯会因为键对不上而静默失效。
 */
export const getSongQualityKey = (
  song: Pick<Song, "id" | "source">,
  quality: AudioQuality,
): string => `${getSongKey(song)}:${quality}`;
export const MEDIA_ERR_SRC_NOT_SUPPORTED_CODE = 4;
/** 进度超过该比例即视为"接近结束"，让只关心阈值的订阅方避开 10Hz 的进度刷新。 */
export const NEAR_END_PROGRESS_RATIO = 0.92;

// DOMException 在部分运行时里不是 Error 的实例，这里只按 name 判定。
export const isAbortError = (error: unknown): boolean =>
  typeof error === "object" && error !== null &&
  (error as { name?: unknown }).name === "AbortError";

/**
 * Drop every quality variant cached for one song. Clearing the whole map would also throw away the
 * already preloaded next track.
 */
export const evictParsedCacheForSong = (
  cache: Map<string, ParsedSongCacheEntry>,
  song: Pick<Song, "id" | "source">,
): void => {
  const prefix = `${getSongKey(song)}:`;
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
};

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
    hasSyncedRows: rows.some((row) => !row.untimed),
    hasTranslation: hasTranslatedLyrics(rows),
    hasTimedWords: hasRealTimedWords(rows),
  };
};

export const shouldUseLyricCandidate = isLyricImprovement;

export const shouldFetchBetterLyrics = (song: Pick<Song, "source">, lrc?: string): boolean => {
  const stats = getLyricStats(lrc);
  if (!stats.hasRows || !stats.hasSyncedRows) return true;
  const needsTimedWords = !stats.hasTimedWords;
  const needsTranslation = supportsTranslatedLyricFallback(song.source) && !stats.hasTranslation;
  return needsTimedWords || needsTranslation;
};

export const shouldUseCors = (url: string): boolean =>
  !url.includes("kuwo.cn") && !url.includes("sycdn.kuwo");
