import { useCallback, useMemo } from "react";
import { getNextRecommendationCandidateIndex } from "../contexts/playerQueue";
import { getSongKey } from "../types";
import type { AudioQuality, Song } from "../types";
import type { RecommendationPlayback } from "./useRecommendationPlayback";
import type { PlayerRuntime } from "./usePlayerRuntime";

export const usePlaybackRecovery = (
  runtime: PlayerRuntime,
  recommendation: RecommendationPlayback,
) => {
  const { refs } = runtime;
  const evictActiveParsedSong = useCallback(() => {
    const cacheKey = refs.activeParsedCacheKey.current;
    if (cacheKey) refs.parsedSongCache.current.delete(cacheKey);
    refs.activeParsedCacheKey.current = null;
  }, [refs]);

  const retryCachedSongResolution = useCallback((song: Song, quality: AudioQuality) => {
    const cacheKey = `${getSongKey(song)}:${quality}`;
    if (refs.activeParsedCacheKey.current !== cacheKey ||
        refs.refreshedCacheKeys.current.has(cacheKey)) return false;
    refs.refreshedCacheKeys.current.add(cacheKey);
    refs.parsedSongCache.current.delete(cacheKey);
    refs.activeParsedCacheKey.current = null;
    void refs.playSong.current(song, quality);
    return true;
  }, [refs]);

  const playNextRecommendationAfterFailure = useCallback((song: Song) => {
    const requestId = song.recommendationRequestId;
    if (!requestId) return false;
    if (refs.failedRecommendationRequestId.current !== requestId) {
      refs.failedRecommendationRequestId.current = requestId;
      refs.failedRecommendationSongKeys.current.clear();
    }
    refs.failedRecommendationSongKeys.current.add(getSongKey(song));
    const nextIndex = getNextRecommendationCandidateIndex(
      refs.queue.current, song, refs.failedRecommendationSongKeys.current,
    );
    const nextSong = nextIndex >= 0 ? refs.queue.current[nextIndex] : undefined;
    if (!nextSong) return false;
    recommendation.showPlayerNotice("当前推荐歌曲不可播放，已自动尝试下一首", "warning");
    void refs.playSong.current(nextSong);
    return true;
  }, [recommendation, refs]);

  return useMemo(() => ({
    evictActiveParsedSong, retryCachedSongResolution, playNextRecommendationAfterFailure,
  }), [evictActiveParsedSong, playNextRecommendationAfterFailure, retryCachedSongResolution]);
};

export type PlaybackRecovery = ReturnType<typeof usePlaybackRecovery>;
