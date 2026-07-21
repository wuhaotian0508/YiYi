import { describe, expect, it } from "vitest";
import { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";
import { buildCalibrationPreferenceProfile, createCalibrationResponse } from "@/domain/preferences/calibration-engine";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { saveUnstructuredVoicePreference, updateProfileFromOutfitFeedback } from "@/domain/preferences/feedback";
import { activeLongTermPreferenceSignals, applyPreferenceDelta, removePreferenceSignal } from "@/domain/preferences/profile-mutations";
import { createRecommendationContext, RecommendationError } from "@/domain/recommendation/context";
import { validateOutfit } from "@/domain/recommendation/constraints";
import { changedAndPreserved, runRecommendationDecision, validateRankingReferences, validateSelectedId } from "@/domain/recommendation/engine";
import { matchesSoftPreference, normalizedWeightsFor, outfitComfortPerformance, outfitSimilarity, outfitThermalPerformance, scoreCandidate, stableOutfitId } from "@/domain/recommendation/scoring";
import { IntentDeltaSchema, PreferenceDeltaSchema, PreferenceRuleSchema, type IntentDelta, type PreferenceDelta, type WardrobeItem } from "@/domain/schemas";
import { demoIntent, demoPreferenceProfile, demoWardrobe } from "@/mocks/wardrobe";
import { realtimeAgentInstructions } from "@/prompts/realtime-agent";

const rain = { minApparentTempC: 8, maxApparentTempC: 13, precipitationProbability: 80, expectedRain: true, windy: true, summary: "Cold rain", sourceTimestamp: 1_721_088_000_000 };
const zeroAdjustments = { formality: 0, warmth: 0, comfort: 0, colorfulness: 0, walkingPriority: 0, layering: 0, structure: 0 };

function delta(input: Partial<IntentDelta> & Pick<IntentDelta, "operation" | "rawUtterance">): IntentDelta {
  return IntentDeltaSchema.parse({ targetSlots: [], preserveSlots: [], requiredItemIds: [], excludedItemIds: [], excludedCategories: [], adjustments: zeroAdjustments, desiredStyleTags: [], undesiredStyleTags: [], confidence: 1, ambiguity: [], ...input });
}

function preferenceDelta(input: Partial<PreferenceDelta> = {}): PreferenceDelta {
  return PreferenceDeltaSchema.parse({ action: "add", signalId: null, attribute: "style", value: "polished", label: "Polished", polarity: "more", strength: "soft", scope: "global_style", categories: [], slots: [], combinationValues: [], confidence: 0.9, needsReview: false, evidenceSummary: null, ...input });
}

function addedItem(id: string, category: WardrobeItem["category"], subtype: string, options: Partial<WardrobeItem> = {}): WardrobeItem {
  return { ...demoWardrobe[2], id, category, subtype, styleTags: ["clean"], occasionTags: ["everyday"], weatherTags: ["mild"], ...options };
}

describe("constraint-first recommendation", () => {
  it("uses a canonical full-width digest for stable outfit identity", () => {
    const first = stableOutfitId({ top: "11111111-1111-4111-8111-111111111111", bottom: "22222222-2222-4222-8222-222222222222", shoes: "33333333-3333-4333-8333-333333333333" });
    const reordered = stableOutfitId({ shoes: "33333333-3333-4333-8333-333333333333", bottom: "22222222-2222-4222-8222-222222222222", top: "11111111-1111-4111-8111-111111111111" });
    const changed = stableOutfitId({ top: "11111111-1111-4111-8111-111111111111", bottom: "22222222-2222-4222-8222-222222222222", shoes: "44444444-4444-4444-8444-444444444444" });
    expect(first).toBe(reordered);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).not.toMatch(/^00000000-0000-4000-8000-/);
    expect(changed).not.toBe(first);
  });
  it("treats an explicitly named available wardrobe item as a required anchor", () => {
    const anchor = demoWardrobe.find((item) => item.availability === "available" && item.category === "top")!;
    const intent = { ...demoIntent, requiredItemIds: [anchor.id], freeformSummary: `I want to wear ${anchor.subtype}.` };
    const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" });
    expect(decision.deterministicAnswer.itemIds.top).toBe(anchor.id);
    expect(realtimeAgentInstructions).toContain("The user may describe their day, name one or more wardrobe anchors, or do both.");
    expect(realtimeAgentInstructions).toContain("Preserve explicitly requested available items unless they conflict with a hard constraint.");
    expect(realtimeAgentInstructions).not.toContain("not choose individual clothes");
  });

  it("routes every initial candidate through the canonical validator", () => {
    const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: demoPreferenceProfile, weather: rain, operation: "initial" });
    expect(decision.candidates.length).toBeGreaterThan(3);
    for (const candidate of decision.candidates) expect(validateOutfit(candidate.itemIds, decision.context)).toEqual({ valid: true, violations: [] });
    expect(decision.diagnostics.finalLegalCount).toBe(decision.candidates.length);
    expect(decision.rankingCandidates.length).toBeLessThanOrEqual(6);
    expect(decision.deterministicAnswer.scoreTrace?.scoringVersion).toBe("constraint-search-v3");
    expect(new Set(decision.candidates.map((candidate) => Object.values(candidate.itemIds).filter(Boolean).length)).size).toBeGreaterThan(1);
  });

  it("injects a low-scoring required item before beam pruning", () => {
    const required = { ...demoWardrobe.find((item) => item.category === "top")!, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", subtype: "Required rough top", formality: 5, comfort: 1, styleTags: ["formal"] };
    const intent = { ...demoIntent, requiredItemIds: [required.id] };
    const decision = runRecommendationDecision({ wardrobe: [...demoWardrobe, required], intent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" });
    expect(decision.candidates.every((candidate) => Object.values(candidate.itemIds).includes(required.id))).toBe(true);
  });

  it("treats a required accessory as a real search anchor", () => {
    const cap = demoWardrobe.find((item) => item.category === "headwear")!;
    const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: { ...demoIntent, requiredItemIds: [cap.id] }, profile: demoPreferenceProfile, weather: null, operation: "initial" });
    expect(decision.candidates.every((candidate) => candidate.itemIds.extraAccessory === cap.id)).toBe(true);
  });

  it("reports the deliberate one-secondary-accessory P0 limit instead of dropping a required item", () => {
    const cap = demoWardrobe.find((item) => item.category === "headwear")!;
    const scarf = addedItem("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9", "scarf", "Required scarf");
    expect(() => runRecommendationDecision({ wardrobe: [...demoWardrobe, scarf], intent: { ...demoIntent, requiredItemIds: [cap.id, scarf.id] }, profile: demoPreferenceProfile, weather: null, operation: "initial" }))
      .toThrowError(expect.objectContaining({ code: "CONFLICTING_REQUIRED_ITEMS", message: expect.stringContaining("extraAccessory") }));
  });

  it("returns an accurate conflict for incompatible required core items", () => {
    const dress = addedItem("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "one_piece", "Clean dress");
    const top = demoWardrobe.find((item) => item.category === "top")!;
    expect(() => runRecommendationDecision({ wardrobe: [...demoWardrobe, dress], intent: { ...demoIntent, excludedCategories: [], requiredItemIds: [dress.id, top.id] }, profile: demoPreferenceProfile, weather: null, operation: "initial" }))
      .toThrowError(expect.objectContaining({ code: "CONFLICTING_REQUIRED_ITEMS" }));
  });

  it("keeps exclusions and rain safety active during targeted revision", () => {
    const dryShoe = { ...demoWardrobe.find((item) => item.category === "shoes")!, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", subtype: "Dry-only shoe", weatherTags: ["dry_only"], comfort: 5 };
    const legalBag = addedItem("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", "bag", "Weather-safe tote", { materials: ["Canvas"], weatherTags: ["rain_safe"], formality: 3 });
    const excludedBag = demoWardrobe.find((item) => item.category === "bag")!;
    const baseIntent = { ...demoIntent, excludedItemIds: [excludedBag.id] };
    const wardrobe = [...demoWardrobe, dryShoe, legalBag];
    const profile = createNeutralPreferenceProfile();
    const initial = runRecommendationDecision({ wardrobe, intent: baseIntent, profile, weather: rain, operation: "initial" }).deterministicAnswer;
    const bagDecision = runRecommendationDecision({ wardrobe, intent: baseIntent, profile, weather: rain, operation: "targeted_revision", currentOutfit: initial, delta: delta({ operation: "targeted_revision", targetSlots: ["bag"], rawUtterance: "Change the bag" }) });
    expect(bagDecision.candidates.every((candidate) => candidate.itemIds.bag !== excludedBag.id)).toBe(true);
    const shoeDecision = runRecommendationDecision({ wardrobe, intent: baseIntent, profile, weather: rain, operation: "targeted_revision", currentOutfit: initial, delta: delta({ operation: "targeted_revision", targetSlots: ["shoes"], rawUtterance: "Change the shoes" }) });
    expect(shoeDecision.candidates.every((candidate) => candidate.itemIds.shoes !== dryShoe.id)).toBe(true);
  });

  it("performs separates-to-one-piece as one atomic structural transition", () => {
    const dress = addedItem("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", "one_piece", "Relaxed dress", { comfort: 5, formality: 3 });
    const initial = runRecommendationDecision({ wardrobe: [...demoWardrobe, dress], intent: { ...demoIntent, excludedCategories: [] }, profile: demoPreferenceProfile, weather: null, operation: "initial" }).candidates.find((candidate) => candidate.itemIds.top)!;
    const decision = runRecommendationDecision({ wardrobe: [...demoWardrobe, dress], intent: { ...demoIntent, excludedCategories: [] }, profile: demoPreferenceProfile, weather: null, operation: "targeted_revision", currentOutfit: initial, delta: delta({ operation: "targeted_revision", targetSlots: ["onePiece"], adjustments: { ...zeroAdjustments, structure: 1 }, rawUtterance: "Make this a dress" }) });
    expect(decision.deterministicAnswer.itemIds.onePiece).toBe(dress.id);
    expect(decision.deterministicAnswer.itemIds.top).toBeUndefined();
    expect(decision.deterministicAnswer.itemIds.bottom).toBeUndefined();
    expect(decision.deterministicAnswer.itemIds.shoes).toBe(initial.itemIds.shoes);
  });

  it("merges broad language meaning only through a validated structured delta", () => {
    const structured = delta({ operation: "global_revision", adjustments: { ...zeroAdjustments, warmth: 0.7, comfort: 0.6, formality: -0.5, colorfulness: -0.7 }, desiredStyleTags: ["casual"], undesiredStyleTags: ["colorful"], preserveSlots: ["shoes"], rawUtterance: "Warmer, more comfortable, more casual, less colorful; keep the shoes" });
    const initial = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: demoPreferenceProfile, weather: null, operation: "initial" }).deterministicAnswer;
    const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: demoPreferenceProfile, weather: null, operation: "global_revision", currentOutfit: initial, delta: structured });
    expect(decision.context.intent.comfortPriority).toBe(5);
    expect(decision.context.intent.desiredFormality).toBe(2);
    expect(decision.context.intent.aestheticTerms).toContain("casual");
    expect(decision.candidates.every((candidate) => candidate.itemIds.shoes === initial.itemIds.shoes)).toBe(true);
  });

  it("enforces explicit hard avoids in deterministic fallback as a canonical constraint", () => {
    const profile = applyPreferenceDelta({ profile: createNeutralPreferenceProfile(), delta: preferenceDelta({ attribute: "color", value: "brown", label: "Brown bags", polarity: "less", strength: "hard", categories: ["bag"], slots: ["bag"] }) });
    const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "fallback" });
    const brownBagIds = demoWardrobe.filter((item) => item.category === "bag" && item.primaryColor === "brown").map((item) => item.id);
    expect(decision.candidates.every((candidate) => !brownBagIds.includes(candidate.itemIds.bag ?? ""))).toBe(true);
    expect(decision.deterministicAnswer.scoreTrace?.searchDiagnostics?.rejectionCounts.HARD_AVOID).toBeGreaterThan(0);
    expect(decision.deterministicAnswer.scoreTrace?.hardConstraintChecks.some((check) => check.rule.startsWith("compiled-hard-avoids"))).toBe(false);
  });

  it("scopes temporary attribute constraints without excluding unrelated items", () => {
    const profile = createNeutralPreferenceProfile();
    const initial = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).deterministicAnswer;
    const decision = runRecommendationDecision({
      wardrobe: demoWardrobe,
      intent: demoIntent,
      profile,
      weather: null,
      operation: "global_revision",
      currentOutfit: initial,
      delta: delta({ operation: "global_revision", rawUtterance: "No brown jacket", temporaryRules: [{ key: "color", value: "brown", polarity: "avoid", strength: "hard", categories: ["outerwear"], slots: ["outerwear"] }] }),
    });
    const brownOuterwear = new Set(demoWardrobe.filter((item) => item.category === "outerwear" && item.primaryColor === "brown").map((item) => item.id));
    const brownBags = new Set(demoWardrobe.filter((item) => item.category === "bag" && item.primaryColor === "brown").map((item) => item.id));
    expect(decision.candidates.every((candidate) => !candidate.itemIds.outerwear || !brownOuterwear.has(candidate.itemIds.outerwear))).toBe(true);
    expect(decision.candidates.some((candidate) => candidate.itemIds.bag && brownBags.has(candidate.itemIds.bag))).toBe(true);
  });

  it("uses personalization semantics to change ranking direction", () => {
    const polished = applyPreferenceDelta({ profile: createNeutralPreferenceProfile(), delta: preferenceDelta({ value: "polished", label: "Polished" }) });
    const relaxed = applyPreferenceDelta({ profile: createNeutralPreferenceProfile(), delta: preferenceDelta({ value: "relaxed", label: "Relaxed" }) });
    const polishedTop = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: polished, weather: null, operation: "initial" }).deterministicAnswer.itemIds.top;
    const relaxedTop = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: relaxed, weather: null, operation: "initial" }).deterministicAnswer.itemIds.top;
    expect(polishedTop).not.toBe(relaxedTop);
  });

  it("does not turn wardrobe presentation direction into stereotyped style scoring", () => {
    const profile = applyPreferenceDelta({ profile: createNeutralPreferenceProfile(), delta: preferenceDelta({ value: "polished", label: "Polished" }) });
    const answers = (["womenswear", "menswear", "mixed", "neutral"] as const).map((wardrobeDirection) => runRecommendationDecision({
      wardrobe: demoWardrobe,
      intent: demoIntent,
      profile: { ...profile, wardrobeDirection },
      weather: null,
      operation: "initial",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }).deterministicAnswer);
    expect(new Set(answers.map((answer) => answer.id))).toEqual(new Set([answers[0].id]));
    expect(new Set(answers.map((answer) => answer.deterministicScore))).toEqual(new Set([answers[0].deterministicScore]));
  });

  it("maps every structured onboarding Less of option to real wardrobe attributes", () => {
    const gold = demoWardrobe.find((item) => item.metal === "gold")!;
    const blue = demoWardrobe.find((item) => item.primaryColor === "blue")!;
    const formal = demoWardrobe.find((item) => item.formality >= 4)!;
    const tight = { ...demoWardrobe.find((item) => item.category === "top")!, fit: "slim" as const };
    const heels = { ...demoWardrobe.find((item) => item.category === "shoes")!, subtype: "Block heels" };
    const cropped = { ...demoWardrobe.find((item) => item.category === "top")!, fit: "cropped" as const };
    const shortSkirt = { ...demoWardrobe.find((item) => item.category === "bottom")!, subtype: "Short skirt" };

    expect(matchesSoftPreference(gold, "Gold-tone jewelry")).toBe(true);
    expect(matchesSoftPreference(gold, "Silver-tone jewelry")).toBe(false);
    expect(matchesSoftPreference(blue, "Bright colors")).toBe(true);
    expect(matchesSoftPreference(formal, "Formal looks")).toBe(true);
    expect(matchesSoftPreference(tight, "Tight fits")).toBe(true);
    expect(matchesSoftPreference(heels, "Heels")).toBe(true);
    expect(matchesSoftPreference(cropped, "Cropped tops")).toBe(true);
    expect(matchesSoftPreference(shortSkirt, "Short skirts")).toBe(true);
  });

  it("makes a structured Less of choice lower the matching outfit personal fit", () => {
    const profile = createNeutralPreferenceProfile();
    const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" });
    const withGold = decision.candidates.find((candidate) => candidate.itemIds.jewelry === demoWardrobe.find((item) => item.metal === "gold")?.id)!;
    expect(withGold).toBeDefined();
    const baseline = scoreCandidate(withGold.itemIds, decision.context).scoreTrace!.dimensions.personalFit;
    const avoidsGold = applyPreferenceDelta({ profile, delta: preferenceDelta({ attribute: "metal", value: "gold", label: "Gold-tone jewelry", polarity: "less", categories: ["jewelry"], slots: ["jewelry"] }) });
    const avoidContext = createRecommendationContext({ wardrobe: demoWardrobe, intent: demoIntent, profile: avoidsGold, weather: null, operation: "initial" });
    expect(scoreCandidate(withGold.itemIds, avoidContext).scoreTrace!.dimensions.personalFit).toBeLessThan(baseline);
  });

  it("makes an explicit Neither response penalize matching full-look semantics without inventing an opposite style", () => {
    const relaxedQuestion = calibrationCatalogV2.questions[0];
    const profile = buildCalibrationPreferenceProfile({
      direction: "neutral",
      responses: [createCalibrationResponse(relaxedQuestion.id, "neither", 1_750_000_000_000)],
      now: 1_750_000_000_001,
    });
    const relaxedOutfit = {
      top: "22222222-2222-4222-8222-222222222222",
      bottom: "33333333-3333-4333-8333-333333333331",
      shoes: "44444444-4444-4444-8444-444444444441",
      bag: "55555555-5555-4555-8555-555555555552",
    };
    const neutralContext = createRecommendationContext({
      wardrobe: demoWardrobe,
      intent: demoIntent,
      profile: createNeutralPreferenceProfile(),
      weather: null,
      operation: "initial",
    });
    const calibratedContext = createRecommendationContext({
      wardrobe: demoWardrobe,
      intent: demoIntent,
      profile,
      weather: null,
      operation: "initial",
    });
    const baseline = scoreCandidate(relaxedOutfit, neutralContext).scoreTrace!.dimensions.personalFit;
    const calibrated = scoreCandidate(relaxedOutfit, calibratedContext).scoreTrace!.dimensions.personalFit;

    expect(calibrated).toBeLessThan(baseline - 0.02);
  });

  it("avoids session repeats until unseen legal answers are exhausted", () => {
    const first = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: demoPreferenceProfile, weather: null, operation: "initial" }).deterministicAnswer;
    const shown = new Set([first.id]);
    const secondDecision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: demoPreferenceProfile, weather: null, operation: "random_new_outfit", currentOutfit: first, delta: delta({ operation: "random_new_outfit", rawUtterance: "Another" }), shownOutfitIds: shown, requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1" });
    const second = secondDecision.deterministicAnswer;
    shown.add(second.id);
    const third = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: demoPreferenceProfile, weather: null, operation: "random_new_outfit", currentOutfit: second, delta: delta({ operation: "random_new_outfit", rawUtterance: "Another" }), shownOutfitIds: shown, requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2" }).deterministicAnswer;
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    expect(outfitSimilarity(first, second, secondDecision.context)).toBeLessThan(0.9);
  });

  it("reports no replacement instead of returning a fake targeted success", () => {
    const oneBagWardrobe = demoWardrobe.filter((item, index) => item.category !== "bag" || index === demoWardrobe.findIndex((entry) => entry.category === "bag"));
    const initial = runRecommendationDecision({ wardrobe: oneBagWardrobe, intent: demoIntent, profile: demoPreferenceProfile, weather: null, operation: "initial" }).candidates.find((candidate) => candidate.itemIds.bag)!;
    expect(() => runRecommendationDecision({ wardrobe: oneBagWardrobe, intent: demoIntent, profile: demoPreferenceProfile, weather: null, operation: "targeted_revision", currentOutfit: initial, delta: delta({ operation: "targeted_revision", targetSlots: ["bag"], rawUtterance: "Change the bag" }) }))
      .toThrowError(expect.objectContaining({ code: "TARGET_REPLACEMENT_UNAVAILABLE" }));
  });

  it("tracks changed and preserved IDs and validates supplied visual IDs", () => {
    const profile = createNeutralPreferenceProfile();
    const current = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).deterministicAnswer;
    const revised = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "targeted_revision", currentOutfit: current, delta: delta({ operation: "targeted_revision", targetSlots: ["bag"], rawUtterance: "Change the bag" }) }).deterministicAnswer;
    const changes = changedAndPreserved(current, revised);
    expect(changes.changedItemIds).toHaveLength(2);
    expect(changes.preservedItemIds.length).toBeGreaterThanOrEqual(4);
    expect(validateSelectedId([current.id, revised.id], revised.id)).toBe(true);
    expect(validateSelectedId([current.id], revised.id)).toBe(false);
    expect(validateRankingReferences([current.id, revised.id], revised.id, [current.id, revised.id])).toBe(true);
    expect(validateRankingReferences([current.id, revised.id], revised.id, [current.id])).toBe(false);
    expect(validateRankingReferences([current.id, revised.id], revised.id, [revised.id, "99999999-9999-4999-8999-999999999999"])).toBe(false);
    expect(RecommendationError).toBeDefined();
  });

  it("uses requiredItemIds for hard positive requirements instead of accepting a fake hard prefer", () => {
    expect(PreferenceRuleSchema.safeParse({ key: "color", value: "red", strength: "hard", polarity: "prefer" }).success).toBe(false);
    expect(PreferenceRuleSchema.safeParse({ key: "color", value: "red", strength: "soft", polarity: "prefer" }).success).toBe(true);
  });

  it("keeps non-thermal accessories out of body warmth", () => {
    const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: rain, operation: "initial" });
    const withBag = decision.candidates.find((candidate) => candidate.itemIds.bag)!;
    const withoutBag = { ...withBag.itemIds, bag: undefined };
    expect(outfitThermalPerformance(withBag.itemIds, decision.context)).toBe(outfitThermalPerformance(withoutBag, decision.context));
  });

  it("keeps outfit comfort intrinsic while walking priority changes only normalized weights", () => {
    const profile = createNeutralPreferenceProfile();
    const low = createRecommendationContext({ wardrobe: demoWardrobe, intent: { ...demoIntent, comfortPriority: 1, walkingIntensity: 1 }, profile, weather: null, operation: "initial" });
    const high = createRecommendationContext({ wardrobe: demoWardrobe, intent: { ...demoIntent, comfortPriority: 1, walkingIntensity: 4 }, profile, weather: null, operation: "initial" });
    const outfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).deterministicAnswer;
    expect(outfitComfortPerformance(outfit.itemIds, low)).toBe(outfitComfortPerformance(outfit.itemIds, high));
    expect(normalizedWeightsFor(high).comfortPracticality).toBeGreaterThan(normalizedWeightsFor(low).comfortPracticality);
    expect(Object.values(normalizedWeightsFor(high)).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
    expect(normalizedWeightsFor(high)).not.toHaveProperty("revisionCompliance");
  });

  it("stores unsafe free-form voice preferences as notes instead of expanding them into hard bans", () => {
    const updated = saveUnstructuredVoicePreference({ profile: createNeutralPreferenceProfile(), rule: "I do not like black and white together", polarity: "avoid", evidencePhrase: "I usually avoid black and white together", now: 1 });
    expect(updated.hardAvoids).toEqual([]);
    expect(updated.softPreferences).toEqual([]);
    expect(updated.preferenceSignals).toContainEqual(expect.objectContaining({ attribute: "preference_note", status: "needs_review", polarity: "less" }));
    const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: updated, weather: null, operation: "initial" });
    expect(decision.candidates.some((candidate) => Object.values(candidate.itemIds).some((id) => demoWardrobe.find((item) => item.id === id)?.primaryColor === "black"))).toBe(true);
    expect(decision.candidates.some((candidate) => Object.values(candidate.itemIds).some((id) => demoWardrobe.find((item) => item.id === id)?.primaryColor === "white"))).toBe(true);
  });

  it("does not learn a one-day aesthetic term as a stable confirmation preference", () => {
    const profile = createNeutralPreferenceProfile();
    const outfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).deterministicAnswer;
    const learned = updateProfileFromOutfitFeedback({ profile, outfit, wardrobe: demoWardrobe, kind: "confirmed", intent: { ...demoIntent, aestheticTerms: ["polished", "relaxed", "clean"] }, contextId: "day-one", now: 1 });
    const tags = (learned.preferenceSignals ?? []).filter((signal) => signal.provenance.source === "confirmation").map((signal) => signal.value);
    expect(tags).not.toContain("polished");
    expect(tags).not.toContain("relaxed");
    expect(tags).not.toContain("clean");
  });

  it("lets repeated cross-context confirmations move subsequent personal-fit scoring", () => {
    const neutral = createNeutralPreferenceProfile();
    const outfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: { ...demoIntent, aestheticTerms: [] }, profile: neutral, weather: null, operation: "initial" }).deterministicAnswer;
    let learned = neutral;
    for (let index = 0; index < 3; index += 1) learned = updateProfileFromOutfitFeedback({ profile: learned, outfit, wardrobe: demoWardrobe, kind: "confirmed", intent: { ...demoIntent, aestheticTerms: [] }, contextId: `session-${index + 1}`, now: index + 1 });
    const baselineContext = createRecommendationContext({ wardrobe: demoWardrobe, intent: { ...demoIntent, aestheticTerms: [] }, profile: neutral, weather: null, operation: "initial" });
    const learnedContext = createRecommendationContext({ wardrobe: demoWardrobe, intent: { ...demoIntent, aestheticTerms: [] }, profile: learned, weather: null, operation: "initial" });
    const baseline = scoreCandidate(outfit.itemIds, baselineContext).scoreTrace!.dimensions.personalFit;
    const after = scoreCandidate(outfit.itemIds, learnedContext).scoreTrace!.dimensions.personalFit;
    expect(after).toBeGreaterThan(baseline);
  });

  it("keeps one confirmation contextual and promotes only repeated evidence from distinct contexts", () => {
    const neutral = createNeutralPreferenceProfile();
    const outfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: { ...demoIntent, aestheticTerms: [] }, profile: neutral, weather: null, operation: "initial" }).deterministicAnswer;
    const baselineContext = createRecommendationContext({ wardrobe: demoWardrobe, intent: { ...demoIntent, aestheticTerms: [] }, profile: neutral, weather: null, operation: "initial" });
    const baseline = scoreCandidate(outfit.itemIds, baselineContext).scoreTrace!.dimensions.personalFit;

    const once = updateProfileFromOutfitFeedback({ profile: neutral, outfit, wardrobe: demoWardrobe, kind: "confirmed", intent: { ...demoIntent, aestheticTerms: [] }, contextId: "same-session", now: 1 });
    const sameContext = updateProfileFromOutfitFeedback({ profile: once, outfit, wardrobe: demoWardrobe, kind: "confirmed", intent: { ...demoIntent, aestheticTerms: [] }, contextId: "same-session", now: 2 });
    expect(activeLongTermPreferenceSignals(once)).toEqual([]);
    expect(activeLongTermPreferenceSignals(sameContext)).toEqual([]);
    expect(scoreCandidate(outfit.itemIds, createRecommendationContext({ wardrobe: demoWardrobe, intent: { ...demoIntent, aestheticTerms: [] }, profile: sameContext, weather: null, operation: "initial" })).scoreTrace!.dimensions.personalFit).toBeCloseTo(baseline, 12);

    const secondContext = updateProfileFromOutfitFeedback({ profile: sameContext, outfit, wardrobe: demoWardrobe, kind: "confirmed", intent: { ...demoIntent, aestheticTerms: [] }, contextId: "different-session", now: 3 });
    expect(activeLongTermPreferenceSignals(secondContext).some((signal) => signal.provenance.source === "confirmation")).toBe(true);
    expect(scoreCandidate(outfit.itemIds, createRecommendationContext({ wardrobe: demoWardrobe, intent: { ...demoIntent, aestheticTerms: [] }, profile: secondContext, weather: null, operation: "initial" })).scoreTrace!.dimensions.personalFit).toBeGreaterThan(baseline);

    let forgotten = secondContext;
    for (const signal of activeLongTermPreferenceSignals(secondContext).filter((entry) => entry.provenance.source === "confirmation")) {
      forgotten = removePreferenceSignal({ profile: forgotten, signalId: signal.id, now: 4 });
    }
    expect(activeLongTermPreferenceSignals(forgotten)).toEqual([]);
    expect(forgotten.preferenceSignals?.filter((signal) => signal.provenance.source === "confirmation" && signal.permanence === "contextual").every((signal) => signal.status === "deleted")).toBe(true);
    const oneNewContext = updateProfileFromOutfitFeedback({ profile: forgotten, outfit, wardrobe: demoWardrobe, kind: "confirmed", intent: { ...demoIntent, aestheticTerms: [] }, contextId: "third-session", now: 5 });
    expect(activeLongTermPreferenceSignals(oneNewContext)).toEqual([]);
  });

  it("uses perceptual outfit features in random-distance comparisons", () => {
    const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" });
    const first = decision.candidates[0];
    const different = decision.candidates.find((candidate) => Boolean(candidate.itemIds.onePiece) !== Boolean(first.itemIds.onePiece)) ?? decision.candidates.at(-1)!;
    expect(outfitSimilarity(first, different, decision.context)).toBeLessThan(outfitSimilarity(first, first, decision.context));
  });

  it("keeps a complementary branch when many individually stronger items share one beam group", () => {
    const requiredBottom = demoWardrobe.find((item) => item.category === "bottom")!;
    const templateTop = demoWardrobe.find((item) => item.category === "top")!;
    const crowded = Array.from({ length: 60 }, (_, index) => ({
      ...templateTop,
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${(100_000_000_000 + index).toString()}`,
      subtype: `Crowded expressive top ${index}`,
      primaryColor: "red" as const,
      styleTags: ["expressive", "statement"],
      comfort: 5,
    }));
    const complement = { ...templateTop, id: "aaaaaaaa-aaaa-4aaa-8aaa-999999999999", subtype: "Quiet tailored complement", primaryColor: "white" as const, styleTags: ["tailored", "clean"], comfort: 2 };
    const wardrobe = [...demoWardrobe.filter((item) => item.category !== "top"), ...crowded, complement];
    const decision = runRecommendationDecision({ wardrobe, intent: { ...demoIntent, requiredItemIds: [requiredBottom.id] }, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" });
    expect(decision.candidates.some((candidate) => candidate.itemIds.top === complement.id)).toBe(true);
  });
});
