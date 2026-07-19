import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { validateOutfit } from "@/domain/recommendation/constraints";
import { runRecommendationDecision } from "@/domain/recommendation/engine";
import { IntentDeltaSchema } from "@/domain/schemas";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";

const golden = JSON.parse(readFileSync(join(process.cwd(), "tests/golden/recommendation-v3.json"), "utf8")) as {
  version: string;
  scenarios: { id: string; operation: string; invariants: string[] }[];
};
const profile = createNeutralPreferenceProfile(1);
const zeroAdjustments = { formality: 0, warmth: 0, comfort: 0, colorfulness: 0, walkingPriority: 0, layering: 0, structure: 0 };
const makeDelta = (input: Record<string, unknown>) => IntentDeltaSchema.parse({ operation: "global_revision", targetSlots: [], preserveSlots: [], requiredItemIds: [], excludedItemIds: [], excludedCategories: [], adjustments: zeroAdjustments, desiredStyleTags: [], undesiredStyleTags: [], rawUtterance: "Golden scenario", confidence: 1, ambiguity: [], ...input });

describe(`versioned recommendation golden scenarios: ${golden.version}`, () => {
  it("keeps the executable scenario registry in sync with the versioned fixture", () => {
    expect(golden.scenarios.map((scenario) => scenario.id)).toEqual([
      "rainy-commute",
      "required-statement-piece",
      "targeted-bag",
      "warmer-keep-shoes",
      "one-piece-transition",
      "random-session-diversity",
    ]);
  });

  it.each(golden.scenarios)("$id satisfies $invariants", ({ id }) => {
    const initial = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }).deterministicAnswer;
    if (id === "rainy-commute") {
      const weather = { minApparentTempC: 5, maxApparentTempC: 10, precipitationProbability: 90, expectedRain: true, windy: true, summary: "Rain", sourceTimestamp: 1 };
      const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: { ...demoIntent, walkingIntensity: 5 }, profile, weather, operation: "initial" });
      expect(decision.candidates.every((outfit) => validateOutfit(outfit.itemIds, decision.context).valid)).toBe(true);
      return;
    }
    if (id === "required-statement-piece") {
      const required = demoWardrobe.find((item) => item.category === "headwear")!;
      const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: { ...demoIntent, requiredItemIds: [required.id] }, profile, weather: null, operation: "initial" });
      expect(decision.candidates.every((outfit) => Object.values(outfit.itemIds).includes(required.id))).toBe(true);
      return;
    }
    if (id === "targeted-bag") {
      const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "targeted_revision", currentOutfit: initial, delta: makeDelta({ operation: "targeted_revision", targetSlots: ["bag"] }) });
      expect(decision.deterministicAnswer.itemIds.bag).not.toBe(initial.itemIds.bag);
      expect(decision.deterministicAnswer.itemIds.shoes).toBe(initial.itemIds.shoes);
      return;
    }
    if (id === "warmer-keep-shoes") {
      const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "global_revision", currentOutfit: initial, delta: makeDelta({ adjustments: { ...zeroAdjustments, warmth: 0.8 }, preserveSlots: ["shoes"] }) });
      expect(decision.context.intent.warmthBias).toBe(0.8);
      expect(decision.deterministicAnswer.itemIds.shoes).toBe(initial.itemIds.shoes);
      return;
    }
    if (id === "one-piece-transition") {
      const dress = { ...demoWardrobe[2], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", category: "one_piece" as const, subtype: "Golden dress" };
      const decision = runRecommendationDecision({ wardrobe: [...demoWardrobe, dress], intent: { ...demoIntent, excludedCategories: [] }, profile, weather: null, operation: "targeted_revision", currentOutfit: initial, delta: makeDelta({ operation: "targeted_revision", targetSlots: ["onePiece"] }) });
      expect(decision.deterministicAnswer.itemIds).toMatchObject({ onePiece: dress.id, shoes: initial.itemIds.shoes });
      expect(decision.deterministicAnswer.itemIds.top).toBeUndefined();
      return;
    }
    const second = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "random_new_outfit", currentOutfit: initial, shownOutfitIds: [initial.id], delta: makeDelta({ operation: "random_new_outfit" }), requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }).deterministicAnswer;
    expect(second.id).not.toBe(initial.id);
  });
});
