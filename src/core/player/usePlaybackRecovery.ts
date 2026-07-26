import { useCallback, useMemo } from "react";
import { getNextRecommendationCandidateIndex } from "../contexts/playerQueue";
import { getSongKey } from "../types";
import type { AudioQuality, Song } from "../types";
import {
  decideRecovery,
  RECOVERY_FALLBACK_QUALITY,
  type RecoveryAction,
  type RecoveryStage,
  type RecoveryTrigger,
} from "./playbackRecovery";
import type { RecommendationPlayback } from "./useRecommendationPlayback";
import type { PlayerRuntime } from "./usePlayerRuntime";

export interface RecoveryRunRequest {
  song: Song;
  quality: AudioQuality;
  trigger: RecoveryTrigger;
  /** 失败确实来自"音源不被支持"、且尚未切换到兼容播放模式。 */
  canRetryWithoutCors: boolean;
  /** 所有降级手段都用尽时的收尾：清理音频源、提示用户、复位加载态。 */
  onGiveUp: () => void;
}

const NO_CORS_NOTICE = "当前音源不支持频谱解析，已切换兼容播放模式";
const QUALITY_FALLBACK_NOTICE = "当前音质不可播放，已尝试切换到 128K";
const RECOMMENDATION_SKIP_NOTICE = "当前推荐歌曲不可播放，已自动尝试下一首";

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
    recommendation.showPlayerNotice(RECOMMENDATION_SKIP_NOTICE, "warning");
    void refs.playSong.current(nextSong);
    return true;
  }, [recommendation, refs]);

  const performRecoveryAction = useCallback((
    action: RecoveryAction,
    request: RecoveryRunRequest,
  ): boolean => {
    if (action === "retryNoCors") {
      recommendation.showPlayerNotice(NO_CORS_NOTICE, "warning");
      refs.forceNoCorsPlayback.current = true;
      void refs.playSong.current(request.song, request.quality);
      return true;
    }
    if (action === "retryRefresh") {
      return retryCachedSongResolution(request.song, request.quality);
    }
    if (action === "downgradeQuality") {
      recommendation.showPlayerNotice(QUALITY_FALLBACK_NOTICE, "warning");
      void refs.playSong.current(request.song, RECOVERY_FALLBACK_QUALITY);
      return true;
    }
    evictActiveParsedSong();
    return playNextRecommendationAfterFailure(request.song);
  }, [evictActiveParsedSong, playNextRecommendationAfterFailure, recommendation,
    refs, retryCachedSongResolution]);

  const runRecovery = useCallback((request: RecoveryRunRequest) => {
    const context = {
      hasRecommendation: Boolean(request.song.recommendationRequestId),
      quality: request.quality,
      canRetryWithoutCors: request.canRetryWithoutCors,
    };
    let stage: RecoveryStage = refs.recoveryStage.current;
    for (;;) {
      const decision = decideRecovery(stage, request.trigger, context);
      stage = decision.nextStage;
      refs.recoveryStage.current = stage;
      if (decision.action === "giveUp") {
        evictActiveParsedSong();
        refs.recoveryStage.current = "initial";
        request.onGiveUp();
        return;
      }
      if (performRecoveryAction(decision.action, request)) return;
    }
  }, [evictActiveParsedSong, performRecoveryAction, refs]);

  return useMemo(() => ({
    evictActiveParsedSong, retryCachedSongResolution,
    playNextRecommendationAfterFailure, runRecovery,
  }), [evictActiveParsedSong, playNextRecommendationAfterFailure,
    retryCachedSongResolution, runRecovery]);
};

export type PlaybackRecovery = ReturnType<typeof usePlaybackRecovery>;
