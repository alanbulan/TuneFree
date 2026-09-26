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
  quality: "320k",
  canRetryWithoutCors: true,
};

describe("decideRecovery", () => {
  it("walks the full ladder for a source-level media error", () => {
    expect(walkLadder("mediaError", fullContext)).toEqual({
      stages: ["corsCompatRetry", "cacheRefresh", "qualityFallback", "songSkip", "failed"],
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
      stages: ["qualityFallback", "songSkip", "failed"],
      actions: ["downgradeQuality", "skipNext", "giveUp"],
    });
  });

  it("still tries the next song on a missing url at the lowest quality", () => {
    expect(walkLadder("missingUrl", { quality: "128k", canRetryWithoutCors: false }).actions)
      .toEqual(["skipNext", "giveUp"]);
  });

  it("never offers a quality downgrade when already at 128k", () => {
    const { actions } = walkLadder("mediaError", { ...fullContext, quality: "128k" });
    expect(actions).not.toContain("downgradeQuality");
    expect(actions).toEqual(["retryNoCors", "retryRefresh", "skipNext", "giveUp"]);
  });

  it("resumes from an intermediate stage instead of restarting the ladder", () => {
    expect(decideRecovery("cacheRefresh", "mediaError", fullContext)).toEqual({
      nextStage: "qualityFallback", action: "downgradeQuality",
    });
    expect(decideRecovery("qualityFallback", "mediaError", fullContext)).toEqual({
      nextStage: "songSkip", action: "skipNext",
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
