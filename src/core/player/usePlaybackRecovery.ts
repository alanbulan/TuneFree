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
import { getSongQualityKey } from "./playerUtils";
import { resolveNextPlayableIndex } from "./queueNavigation";
import type { RecommendationPlayback } from "./useRecommendationPlayback";
import type { PlayerRuntime } from "./usePlayerRuntime";

export interface RecoveryRunRequest {
  song: Song;
  quality: AudioQuality;
  trigger: RecoveryTrigger;
  /** 失败确实来自"音源不被支持"、且尚未切换到兼容播放模式。 */
  canRetryWithoutCors: boolean;
  /**
   * 所有降级手段都用尽时的收尾：清理音频源、提示用户、复位加载态。
   * 传入 `notice` 时优先展示它（如连续多首失败），否则由调用方按失败原因提示。
   */
  onGiveUp: (notice?: string) => void;
}

/** 普通队列连续失败的上限：音源整体不可用时及时停下，而不是把整张歌单刷一遍。 */
export const MAX_CONSECUTIVE_SONG_FAILURES = 5;
/** 同一首歌同一音质最多重新解析几次；每次都排除已经放不了的地址，让链路换到后面的音源。 */
export const MAX_URL_REFRESHES = 2;

const NO_CORS_NOTICE = "当前音源不支持频谱解析，已切换兼容播放模式";
const QUALITY_FALLBACK_NOTICE = "当前音质不可播放，本首已临时切换到 128K";
const RECOMMENDATION_SKIP_NOTICE = "当前推荐歌曲不可播放，已自动尝试下一首";
const songSkipNotice = (song: Song) => `《${song.name}》暂时无法播放，已自动切到下一首`;
const failureStreakNotice = (count: number) =>
  `连续 ${count} 首歌曲无法播放，已停止自动跳过，请到音源页检查音源状态`;

export const usePlaybackRecovery = (
  runtime: PlayerRuntime,
  recommendation: RecommendationPlayback,
) => {
  const { refs, markSongUnplayable } = runtime;
  const {
    activeParsedCacheKey: activeParsedCacheKeyRef, parsedSongCache: parsedSongCacheRef, refreshedResolutions: refreshedResolutionsRef,
    playSong: playSongRef, failedRecommendationRequestId: failedRecommendationRequestIdRef, failedRecommendationSongKeys: failedRecommendationSongKeysRef,
    queue: queueRef, forceNoCorsPlayback: forceNoCorsPlaybackRef, recoveryStage: recoveryStageRef,
    failedQueueSongKeys: failedQueueSongKeysRef, audio: audioRef,
  } = refs;
  const evictActiveParsedSong = useCallback(() => {
    const cacheKey = activeParsedCacheKeyRef.current;
    if (cacheKey) parsedSongCacheRef.current.delete(cacheKey);
    activeParsedCacheKeyRef.current = null;
  }, [activeParsedCacheKeyRef, parsedSongCacheRef]);

  const retryCachedSongResolution = useCallback((song: Song, quality: AudioQuality) => {
    const refreshKey = getSongQualityKey(song, quality);
    const activeKey = activeParsedCacheKeyRef.current;
    // 解析缓存键末尾是音源配置代数，只核对「歌曲 + 音质」部分；离线文件没有缓存键，刷新无意义。
    const failedUrls = refreshedResolutionsRef.current.get(refreshKey) ?? [];
    if (!activeKey?.startsWith(`${refreshKey}:`) || failedUrls.length >= MAX_URL_REFRESHES) return false;
    // 记下刚刚放不了的地址：重新解析时返回这些地址的音源按失败处理，链路继续尝试下一个音源。
    const failedUrl = audioRef.current?.src ?? "";
    refreshedResolutionsRef.current.set(refreshKey,
      [...failedUrls, failedUrl === window.location.href ? "" : failedUrl]);
    parsedSongCacheRef.current.delete(activeKey);
    activeParsedCacheKeyRef.current = null;
    void playSongRef.current(song, quality);
    return true;
  }, [activeParsedCacheKeyRef, parsedSongCacheRef, refreshedResolutionsRef, playSongRef, audioRef]);

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
    recommendation.showPlayerNotice(RECOMMENDATION_SKIP_NOTICE, "warning", "songSkipped");
    void playSongRef.current(nextSong);
    return true;
  }, [recommendation, playSongRef, failedRecommendationRequestIdRef, failedRecommendationSongKeysRef, queueRef]);

  /** 推荐歌曲只在同批次内接力；普通队列按播放顺序跳到下一首，并限制连续失败次数。 */
  const skipFailedSong = useCallback((song: Song) => {
    if (song.recommendationRequestId) return playNextRecommendationAfterFailure(song);
    const failedKeys = failedQueueSongKeysRef.current;
    failedKeys.add(getSongKey(song));
    if (failedKeys.size >= MAX_CONSECUTIVE_SONG_FAILURES) return false;
    const nextIndex = resolveNextPlayableIndex(refs, song, failedKeys);
    const nextSong = nextIndex >= 0 ? queueRef.current[nextIndex] : undefined;
    if (!nextSong) return false;
    recommendation.showPlayerNotice(songSkipNotice(song), "warning", "songSkipped");
    void playSongRef.current(nextSong);
    return true;
  }, [playNextRecommendationAfterFailure, recommendation, refs, failedQueueSongKeysRef, playSongRef, queueRef]);

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
      if (!retryCachedSongResolution(request.song, request.quality)) return false;
      // 刷新可以重复（次数由 retryCachedSongResolution 把关），阶段退回起点，下次失败还能再刷新。
      recoveryStageRef.current = "initial";
      return true;
    }
    if (action === "downgradeQuality") {
      // 只对这一首临时降级，不改写用户保存的音质偏好：下一首仍按偏好音质尝试。
      recommendation.showPlayerNotice(QUALITY_FALLBACK_NOTICE, "warning");
      void playSongRef.current(request.song, RECOVERY_FALLBACK_QUALITY);
      return true;
    }
    evictActiveParsedSong();
    markSongUnplayable(request.song, true);
    return skipFailedSong(request.song);
  }, [evictActiveParsedSong, skipFailedSong, recommendation, retryCachedSongResolution, playSongRef, forceNoCorsPlaybackRef, markSongUnplayable, recoveryStageRef]);

  const runRecovery = useCallback((request: RecoveryRunRequest) => {
    const context = {
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
        markSongUnplayable(request.song, true);
        recoveryStageRef.current = "initial";
        // 放弃后重新计数：用户手动再播时不应被上一轮的失败记录直接拦下。
        const failureCount = failedQueueSongKeysRef.current.size;
        failedQueueSongKeysRef.current.clear();
        request.onGiveUp(failureCount >= MAX_CONSECUTIVE_SONG_FAILURES
          ? failureStreakNotice(failureCount) : undefined);
        return;
      }
      if (performRecoveryAction(decision.action, request)) return;
    }
  }, [evictActiveParsedSong, performRecoveryAction, markSongUnplayable, recoveryStageRef, failedQueueSongKeysRef]);

  return useMemo(() => ({
    evictActiveParsedSong, retryCachedSongResolution, skipFailedSong, runRecovery,
  }), [evictActiveParsedSong, retryCachedSongResolution, skipFailedSong, runRecovery]);
};

export type PlaybackRecovery = ReturnType<typeof usePlaybackRecovery>;
