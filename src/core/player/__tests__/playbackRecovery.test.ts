import { describe, expect, it } from "vitest";
import {
  decideRecovery,
  type RecoveryAction,
  type RecoveryContext,
  type RecoveryStage,
  type RecoveryTrigger,
} from "../playbackRecovery";

/** 从 initial 一路走到 giveUp，收集完整的降级路径。 */
const walkLadder = (
  trigger: RecoveryTrigger,
  context: RecoveryContext,
): { stages: RecoveryStage[]; actions: RecoveryAction[] } => {
  const stages: RecoveryStage[] = [];
  const actions: RecoveryAction[] = [];
  let stage: RecoveryStage = "initial";
  for (let guard = 0; guard < 10; guard += 1) {
    const decision = decideRecovery(stage, trigger, context);
    stages.push(decision.nextStage);
    actions.push(decision.action);
    stage = decision.nextStage;
    if (decision.action === "giveUp") break;
  }
  return { stages, actions };
};

const fullContext: RecoveryContext = {
  hasRecommendation: true,
  quality: "320k",
  canRetryWithoutCors: true,
};

describe("decideRecovery", () => {
  it("walks the full ladder for a source-level media error", () => {
    expect(walkLadder("mediaError", fullContext)).toEqual({
      stages: ["corsCompatRetry", "cacheRefresh", "qualityFallback",
        "recommendationSkip", "failed"],
      actions: ["retryNoCors", "retryRefresh", "downgradeQuality", "skipNext", "giveUp"],
    });
  });

  it("walks the full ladder for a rejected play() call", () => {
    expect(walkLadder("playRejected", fullContext).actions).toEqual([
      "retryNoCors", "retryRefresh", "downgradeQuality", "skipNext", "giveUp",
    ]);
  });

  it("skips the compat retry when the failure is not a source error", () => {
    expect(walkLadder("mediaError", { ...fullContext, canRetryWithoutCors: false }).actions)
      .toEqual(["retryRefresh", "downgradeQuality", "skipNext", "giveUp"]);
  });

  it("skips both compat retry and cache refresh when the resolver returned no url", () => {
    expect(walkLadder("missingUrl", fullContext)).toEqual({
      stages: ["qualityFallback", "recommendationSkip", "failed"],
      actions: ["downgradeQuality", "skipNext", "giveUp"],
    });
  });

  it("gives up immediately on a missing url at the lowest quality without recommendations", () => {
    expect(walkLadder("missingUrl", {
      hasRecommendation: false, quality: "128k", canRetryWithoutCors: false,
    }).actions).toEqual(["giveUp"]);
  });

  it("never offers a quality downgrade when already at 128k", () => {
    const { actions } = walkLadder("mediaError", { ...fullContext, quality: "128k" });
    expect(actions).not.toContain("downgradeQuality");
    expect(actions).toEqual(["retryNoCors", "retryRefresh", "skipNext", "giveUp"]);
  });

  it("never offers a recommendation skip for a non-recommendation song", () => {
    const { actions } = walkLadder("playRejected", {
      ...fullContext, hasRecommendation: false,
    });
    expect(actions).not.toContain("skipNext");
    expect(actions).toEqual(["retryNoCors", "retryRefresh", "downgradeQuality", "giveUp"]);
  });

  it("resumes from an intermediate stage instead of restarting the ladder", () => {
    expect(decideRecovery("cacheRefresh", "mediaError", fullContext)).toEqual({
      nextStage: "qualityFallback", action: "downgradeQuality",
    });
    expect(decideRecovery("qualityFallback", "mediaError", fullContext)).toEqual({
      nextStage: "recommendationSkip", action: "skipNext",
    });
  });

  it("stays terminal once failed", () => {
    for (const trigger of ["mediaError", "playRejected", "missingUrl"] as RecoveryTrigger[]) {
      expect(decideRecovery("failed", trigger, fullContext)).toEqual({
        nextStage: "failed", action: "giveUp",
      });
    }
  });
});
