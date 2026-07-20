import { describe, expect, it } from "vitest";
import { runReleaseRecommendationEval } from "../../release-audit/02-recommendation/eval-runner";

describe("release recommendation evaluation", () => {
  it("meets the versioned deterministic release invariants", () => {
    const result = runReleaseRecommendationEval();
    if (process.env.YIYI_PRINT_EVAL === "true") console.log(JSON.stringify(result, null, 2));
    expect(result.failures).toEqual([]);
    expect(result.metrics).toMatchObject({
      version: "release-eval-v1",
      hardConstraintViolationRate: 0,
      legalCandidateRecall: 1,
      requiredAnchorSuccessRate: 1,
      targetedSlotPreservationRate: 1,
      nonTargetStabilityRate: 1,
      duplicateSessionRepeatRate: 0,
      fallbackLegalityRate: 1,
      deterministicReproducibilityRate: 1,
      explanationFaithfulnessRate: 1,
      personalizationCausalityRate: 1,
      calibrationCausalityRate: 1,
    });
  });
});
