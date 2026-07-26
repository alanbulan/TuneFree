/**
 * Explicit playback-failure recovery ladder.
 *
 * The media-element error handler, the `play()` rejection handler and the "resolver returned no
 * url" handler all used to escalate through the same fallbacks with their own ad-hoc retry-count
 * comparisons. They now share this pure state machine so the stage semantics are defined once.
 */
export type RecoveryStage =
  | "initial"
  | "corsCompatRetry"
  | "cacheRefresh"
  | "qualityFallback"
  | "recommendationSkip"
  | "failed";

export type RecoveryTrigger = "mediaError" | "playRejected" | "missingUrl";

export type RecoveryAction =
  | "retryNoCors"
  | "retryRefresh"
  | "downgradeQuality"
  | "skipNext"
  | "giveUp";

export interface RecoveryContext {
  /** 当前歌曲是否来自一次 AI 推荐请求（决定能否跳到同批次的下一首）。 */
  hasRecommendation: boolean;
  quality: string;
  /**
   * 仅当失败确实来自"音源不被支持"、且尚未切换到兼容播放模式时为 true。
   * 网络类错误重载一次无 CORS 的音频元素毫无意义，所以这一级必须由调用方判定。
   */
  canRetryWithoutCors?: boolean;
}

export interface RecoveryDecision {
  nextStage: RecoveryStage;
  action: RecoveryAction;
}

export const RECOVERY_FALLBACK_QUALITY = "128k";

const STAGE_SEQUENCE: readonly RecoveryStage[] = [
  "initial",
  "corsCompatRetry",
  "cacheRefresh",
  "qualityFallback",
  "recommendationSkip",
  "failed",
];

const STAGE_ACTIONS: Record<Exclude<RecoveryStage, "initial">, RecoveryAction> = {
  corsCompatRetry: "retryNoCors",
  cacheRefresh: "retryRefresh",
  qualityFallback: "downgradeQuality",
  recommendationSkip: "skipNext",
  failed: "giveUp",
};

const isStageAvailable = (
  stage: RecoveryStage,
  trigger: RecoveryTrigger,
  context: RecoveryContext,
): boolean => {
  switch (stage) {
    case "corsCompatRetry":
      return trigger !== "missingUrl" && context.canRetryWithoutCors === true;
    case "cacheRefresh":
      // 解析器返回空链接时已经把该缓存条目删掉了，再刷新一次没有任何意义。
      return trigger !== "missingUrl";
    case "qualityFallback":
      return context.quality !== RECOVERY_FALLBACK_QUALITY;
    case "recommendationSkip":
      return context.hasRecommendation;
    default:
      return true;
  }
};

/**
 * Pick the next recovery step after `stage`. The caller performs the returned action and, when the
 * action turns out to be inapplicable at runtime, calls again with the returned `nextStage`.
 */
export const decideRecovery = (
  stage: RecoveryStage,
  trigger: RecoveryTrigger,
  context: RecoveryContext,
): RecoveryDecision => {
  const startIndex = STAGE_SEQUENCE.indexOf(stage);
  for (let index = Math.max(startIndex, 0) + 1; index < STAGE_SEQUENCE.length; index += 1) {
    const candidate = STAGE_SEQUENCE[index];
    if (candidate !== "initial" && isStageAvailable(candidate, trigger, context)) {
      return { nextStage: candidate, action: STAGE_ACTIONS[candidate] };
    }
  }
  return { nextStage: "failed", action: "giveUp" };
};
