import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { validateOutfit } from "@/domain/recommendation/constraints";
import { createRecommendationContext } from "@/domain/recommendation/context";
import { runRecommendationDecision } from "@/domain/recommendation/engine";
import { normalizedWeightsFor, outfitComfortPerformance, outfitThermalPerformance } from "@/domain/recommendation/scoring";
import { IntentDeltaSchema, type IntentDelta, type WardrobeItem } from "@/domain/schemas";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";

const zeroAdjustments = { formality: 0, warmth: 0, comfort: 0, colorfulness: 0, walkingPriority: 0, layering: 0, structure: 0 };

function delta(input: Partial<IntentDelta> & Pick<IntentDelta, "operation" | "rawUtterance">): IntentDelta {
  return IntentDeltaSchema.parse({ targetSlots: [], preserveSlots: [], requiredItemIds: [], excludedItemIds: [], excludedCategories: [], adjustments: zeroAdjustments, desiredStyleTags: [], undesiredStyleTags: [], confidence: 1, ambiguity: [], ...input });
}

const wardrobeSignals = fc.array(fc.record({
  warmth: fc.integer({ min: 1, max: 5 }),
  formality: fc.integer({ min: 1, max: 5 }),
  comfort: fc.integer({ min: 1, max: 5 }),
  lastWornDaysAgo: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
}), { minLength: demoWardrobe.length, maxLength: demoWardrobe.length });

type WardrobeSignal = { warmth: number; formality: number; comfort: number; lastWornDaysAgo: number | null };

function syntheticWardrobe(signals: WardrobeSignal[]): WardrobeItem[] {
  const now = Date.now();
  return demoWardrobe.map((item, index) => ({
    ...item,
    warmth: signals[index].warmth,
    formality: signals[index].formality,
    comfort: signals[index].comfort,
    lastWornAt: signals[index].lastWornDaysAgo === null ? null : now - signals[index].lastWornDaysAgo * 86_400_000,
  }));
}

describe("recommendation invariants", () => {
  it("never emits an illegal or duplicate outfit for randomized item signals", () => {
    fc.assert(fc.property(wardrobeSignals, fc.boolean(), (signals, rainy) => {
      const wardrobe = syntheticWardrobe(signals);
      const weather = rainy ? { minApparentTempC: 5, maxApparentTempC: 11, precipitationProbability: 90, expectedRain: true, windy: true, summary: "Rain", sourceTimestamp: 1 } : null;
      const decision = runRecommendationDecision({ wardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather, operation: "initial", requestId: "11111111-1111-4111-8111-111111111111" });
      for (const candidate of decision.candidates) {
        expect(validateOutfit(candidate.itemIds, decision.context).valid).toBe(true);
        const ids = Object.values(candidate.itemIds).filter(Boolean);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }), { numRuns: 60 });
  });

  it("keeps every required item and removes every excluded item before ranking", () => {
    const requiredCandidates = demoWardrobe.filter((item) => !["one_piece"].includes(item.category));
    fc.assert(fc.property(
      fc.constantFrom(...requiredCandidates),
      fc.constantFrom(...demoWardrobe),
      (required, excluded) => {
        fc.pre(required.id !== excluded.id);
        const intent = { ...demoIntent, requiredItemIds: [required.id], excludedItemIds: [excluded.id] };
        const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" });
        for (const candidate of decision.candidates) {
          const ids = Object.values(candidate.itemIds);
          expect(ids).toContain(required.id);
          expect(ids).not.toContain(excluded.id);
        }
      },
    ), { numRuns: 50 });
  });

  it("targeted shoe revision preserves every other present and empty slot", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100_000 }), (seed) => {
      const requestId = `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`;
      const initial = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial", requestId }).deterministicAnswer;
      const revised = runRecommendationDecision({
        wardrobe: demoWardrobe,
        intent: demoIntent,
        profile: createNeutralPreferenceProfile(),
        weather: null,
        operation: "targeted_revision",
        currentOutfit: initial,
        delta: delta({ operation: "targeted_revision", targetSlots: ["shoes"], rawUtterance: "Change the shoes" }),
        requestId,
      }).deterministicAnswer;
      expect(revised.itemIds.shoes).not.toBe(initial.itemIds.shoes);
      for (const slot of ["top", "bottom", "onePiece", "outerwear", "bag", "jewelry", "extraAccessory"] as const) {
        expect(revised.itemIds[slot]).toBe(initial.itemIds[slot]);
      }
    }), { numRuns: 30 });
  });

  it("is reproducible for the same request seed and prefers unseen random answers", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100_000 }), (seed) => {
      const requestId = `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`;
      const first = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial", requestId }).deterministicAnswer;
      const repeated = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial", requestId }).deterministicAnswer;
      expect(repeated.id).toBe(first.id);
      const random = runRecommendationDecision({
        wardrobe: demoWardrobe,
        intent: demoIntent,
        profile: createNeutralPreferenceProfile(),
        weather: null,
        operation: "random_new_outfit",
        currentOutfit: first,
        shownOutfitIds: [first.id],
        delta: delta({ operation: "random_new_outfit", rawUtterance: "Another outfit" }),
        requestId,
      }).deterministicAnswer;
      expect(random.id).not.toBe(first.id);
    }), { numRuns: 40 });
  });

  it("keeps thermal and intrinsic comfort semantics invariant under irrelevant context changes", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 4 }), (bagWarmth, walkingIntensity) => {
      const wardrobe = demoWardrobe.map((item) => item.category === "bag" ? { ...item, warmth: bagWarmth } : item);
      const profile = createNeutralPreferenceProfile();
      const context = createRecommendationContext({ wardrobe, intent: { ...demoIntent, comfortPriority: 1, walkingIntensity }, profile, weather: null, operation: "initial" });
      const outfit = runRecommendationDecision({ wardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).candidates.find((candidate) => candidate.itemIds.bag)!;
      expect(outfitThermalPerformance(outfit.itemIds, context)).toBe(outfitThermalPerformance({ ...outfit.itemIds, bag: undefined }, context));
      const otherWalking = createRecommendationContext({ wardrobe, intent: { ...demoIntent, comfortPriority: 1, walkingIntensity: walkingIntensity === 4 ? 1 : 4 }, profile, weather: null, operation: "initial" });
      expect(outfitComfortPerformance(outfit.itemIds, context)).toBe(outfitComfortPerformance(outfit.itemIds, otherWalking));
      expect(Object.values(normalizedWeightsFor(context)).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
    }), { numRuns: 30 });
  });
});
