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
  const { refs, setAudioQuality } = runtime;
  const {
    activeParsedCacheKey: activeParsedCacheKeyRef, parsedSongCache: parsedSongCacheRef, refreshedCacheKeys: refreshedCacheKeysRef,
    playSong: playSongRef, failedRecommendationRequestId: failedRecommendationRequestIdRef, failedRecommendationSongKeys: failedRecommendationSongKeysRef,
    queue: queueRef, forceNoCorsPlayback: forceNoCorsPlaybackRef, recoveryStage: recoveryStageRef,
    audioQuality: audioQualityRef,
  } = refs;
  const evictActiveParsedSong = useCallback(() => {
    const cacheKey = activeParsedCacheKeyRef.current;
    if (cacheKey) parsedSongCacheRef.current.delete(cacheKey);
    activeParsedCacheKeyRef.current = null;
  }, [activeParsedCacheKeyRef, parsedSongCacheRef]);

  const retryCachedSongResolution = useCallback((song: Song, quality: AudioQuality) => {
    const cacheKey = `${getSongKey(song)}:${quality}`;
    if (activeParsedCacheKeyRef.current !== cacheKey ||
        refreshedCacheKeysRef.current.has(cacheKey)) return false;
    refreshedCacheKeysRef.current.add(cacheKey);
    parsedSongCacheRef.current.delete(cacheKey);
    activeParsedCacheKeyRef.current = null;
    void playSongRef.current(song, quality);
    return true;
  }, [activeParsedCacheKeyRef, parsedSongCacheRef, refreshedCacheKeysRef, playSongRef]);

  const playNextRecommendationAfterFailure = useCallback((song: Song) => {
    const requestId = song.recommendationRequestId;
    if (!requestId) return false;
    if (failedRecommendationRequestIdRef.current !== requestId) {
      failedRecommendationRequestIdRef.current = requestId;
      failedRecommendationSongKeysRef.current.clear();
    }
    failedRecommendationSongKeysRef.current.add(getSongKey(song));
    const nextIndex = getNextRecommendationCandidateIndex(
      queueRef.current, song, failedRecommendationSongKeysRef.current,
    );
    const nextSong = nextIndex >= 0 ? queueRef.current[nextIndex] : undefined;
    if (!nextSong) return false;
    recommendation.showPlayerNotice(RECOMMENDATION_SKIP_NOTICE, "warning");
    void playSongRef.current(nextSong);
    return true;
  }, [recommendation, playSongRef, failedRecommendationRequestIdRef, failedRecommendationSongKeysRef, queueRef]);

  const performRecoveryAction = useCallback((
    action: RecoveryAction,
    request: RecoveryRunRequest,
  ): boolean => {
    if (action === "retryNoCors") {
      recommendation.showPlayerNotice(NO_CORS_NOTICE, "warning");
      forceNoCorsPlaybackRef.current = true;
      void playSongRef.current(request.song, request.quality);
      return true;
    }
    if (action === "retryRefresh") {
      return retryCachedSongResolution(request.song, request.quality);
    }
    if (action === "downgradeQuality") {
      audioQualityRef.current = RECOVERY_FALLBACK_QUALITY;
      setAudioQuality(RECOVERY_FALLBACK_QUALITY);
      recommendation.showPlayerNotice(QUALITY_FALLBACK_NOTICE, "warning");
      void playSongRef.current(request.song, RECOVERY_FALLBACK_QUALITY);
      return true;
    }
    evictActiveParsedSong();
    return playNextRecommendationAfterFailure(request.song);
  }, [evictActiveParsedSong, playNextRecommendationAfterFailure, recommendation, retryCachedSongResolution, playSongRef, forceNoCorsPlaybackRef, audioQualityRef, setAudioQuality]);

  const runRecovery = useCallback((request: RecoveryRunRequest) => {
    const context = {
      hasRecommendation: Boolean(request.song.recommendationRequestId),
      quality: request.quality,
      canRetryWithoutCors: request.canRetryWithoutCors,
    };
    let stage: RecoveryStage = recoveryStageRef.current;
    for (;;) {
      const decision = decideRecovery(stage, request.trigger, context);
      stage = decision.nextStage;
      recoveryStageRef.current = stage;
      if (decision.action === "giveUp") {
        evictActiveParsedSong();
        recoveryStageRef.current = "initial";
        request.onGiveUp();
        return;
      }
      if (performRecoveryAction(decision.action, request)) return;
    }
  }, [evictActiveParsedSong, performRecoveryAction, recoveryStageRef]);

  return useMemo(() => ({
    evictActiveParsedSong, retryCachedSongResolution,
    playNextRecommendationAfterFailure, runRecovery,
  }), [evictActiveParsedSong, playNextRecommendationAfterFailure,
    retryCachedSongResolution, runRecovery]);
};

export type PlaybackRecovery = ReturnType<typeof usePlaybackRecovery>;
