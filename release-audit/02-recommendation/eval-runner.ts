import { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";
import { buildCalibrationPreferenceProfile, createCalibrationResponse } from "@/domain/preferences/calibration-engine";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { applyPreferenceDelta } from "@/domain/preferences/profile-mutations";
import { validateOutfit } from "@/domain/recommendation/constraints";
import { RecommendationError } from "@/domain/recommendation/context";
import { applyVisualRanking, runRecommendationDecision } from "@/domain/recommendation/engine";
import { outfitSimilarity } from "@/domain/recommendation/scoring";
import { PreferenceDeltaSchema, type Outfit, type WardrobeItem } from "@/domain/schemas";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";

type Failure = { scenario: string; invariant: string; detail: string };

export type ReleaseRecommendationMetrics = {
  version: "release-eval-v1";
  scenarioCount: number;
  candidateCount: number;
  hardConstraintViolationRate: number;
  legalCandidateRecall: number;
  requiredAnchorSuccessRate: number;
  targetedSlotPreservationRate: number;
  nonTargetStabilityRate: number;
  duplicateSessionRepeatRate: number;
  fallbackLegalityRate: number;
  deterministicReproducibilityRate: number;
  explanationFaithfulnessRate: number;
  personalizationCausalityRate: number;
  calibrationCausalityRate: number;
  maxExpandedPartials: number;
  maxReturnedCandidates: number;
};

export type ReleaseRecommendationEval = { metrics: ReleaseRecommendationMetrics; failures: Failure[] };

function fail(failures: Failure[], scenario: string, invariant: string, detail: string, condition: boolean) {
  if (!condition) failures.push({ scenario, invariant, detail });
  return condition;
}

function weightedTotal(outfit: Outfit) {
  const trace = outfit.scoreTrace!;
  return Object.entries(trace.weights).reduce((sum, [key, weight]) => {
    const value = trace.dimensions[key as keyof typeof trace.dimensions];
    return sum + (typeof value === "number" ? value : 0) * weight;
  }, 0);
}

function largeWardrobe() {
  return Array.from({ length: 4 }, (_, copy) => demoWardrobe.map((item, index): WardrobeItem => ({
    ...item,
    id: copy === 0 ? item.id : `90000000-0000-4000-8000-${String(copy * 100 + index).padStart(12, "0")}`,
    subtype: copy === 0 ? item.subtype : `${item.subtype} ${copy + 1}`,
    primaryColor: copy === 0 ? item.primaryColor : (["black", "navy", "beige"] as const)[copy - 1],
  }))).flat();
}

export function runReleaseRecommendationEval(): ReleaseRecommendationEval {
  const failures: Failure[] = [];
  const neutral = createNeutralPreferenceProfile(1);
  const requestId = "aaaaaaaa-0000-4000-8000-000000000001";
  const decisions = [] as ReturnType<typeof runRecommendationDecision>[];

  const tinyWardrobe = [
    ...demoWardrobe.filter((item) => item.category === "top").slice(0, 2),
    ...demoWardrobe.filter((item) => item.category === "bottom").slice(0, 2),
    ...demoWardrobe.filter((item) => item.category === "shoes").slice(0, 2),
  ];
  const tiny = runRecommendationDecision({ wardrobe: tinyWardrobe, intent: demoIntent, profile: neutral, weather: null, operation: "initial", requestId });
  const tinyRepeat = runRecommendationDecision({ wardrobe: tinyWardrobe, intent: demoIntent, profile: neutral, weather: null, operation: "initial", requestId });
  decisions.push(tiny);
  const legalRecall = tiny.candidates.length / 8;
  const reproducible = tiny.candidates.map((entry) => entry.id).join("|") === tinyRepeat.candidates.map((entry) => entry.id).join("|")
    && tiny.deterministicAnswer.id === tinyRepeat.deterministicAnswer.id;
  fail(failures, "tiny-exhaustive", "legal-candidate-recall", `expected 8 candidates, got ${tiny.candidates.length}`, legalRecall === 1);
  fail(failures, "tiny-exhaustive", "reproducibility", "same seed produced a different result", reproducible);

  const large = runRecommendationDecision({ wardrobe: largeWardrobe(), intent: demoIntent, profile: neutral, weather: null, operation: "initial", requestId });
  decisions.push(large);
  fail(failures, "large-wardrobe", "candidate-cap", `returned ${large.candidates.length}`, large.candidates.length <= 64);
  fail(failures, "large-wardrobe", "bounded-expansion", `expanded ${large.diagnostics.expandedPartialCount}`, large.diagnostics.expandedPartialCount <= 100_000);

  const weather = { minApparentTempC: 4, maxApparentTempC: 9, precipitationProbability: 95, expectedRain: true, windy: true, summary: "Cold rain", sourceTimestamp: 1 };
  const rain = runRecommendationDecision({ wardrobe: demoWardrobe, intent: { ...demoIntent, walkingIntensity: 5 }, profile: neutral, weather, operation: "initial", requestId });
  decisions.push(rain);
  const rainLegal = rain.candidates.every((candidate) => validateOutfit(candidate.itemIds, rain.context).valid);
  fail(failures, "rain-walking", "all-legal", "rain candidate violated a hard rule", rainLegal);

  const required = demoWardrobe.find((item) => item.category === "headwear")!;
  const anchored = runRecommendationDecision({ wardrobe: demoWardrobe, intent: { ...demoIntent, requiredItemIds: [required.id] }, profile: neutral, weather: null, operation: "initial", requestId });
  decisions.push(anchored);
  const requiredSuccess = anchored.candidates.every((candidate) => Object.values(candidate.itemIds).includes(required.id));
  fail(failures, "required-accessory", "required-anchor", "required accessory absent", requiredSuccess);

  const dress = { ...demoWardrobe.find((item) => item.category === "top")!, id: "bbbbbbbb-0000-4000-8000-000000000001", category: "one_piece" as const, subtype: "Test dress" };
  const onePiece = runRecommendationDecision({ wardrobe: [...demoWardrobe, dress], intent: { ...demoIntent, excludedCategories: [], requiredItemIds: [dress.id] }, profile: neutral, weather: null, operation: "initial", requestId });
  decisions.push(onePiece);
  fail(failures, "one-piece", "exclusive-core", "one-piece candidate retained separates", onePiece.candidates.every((candidate) => candidate.itemIds.onePiece === dress.id && !candidate.itemIds.top && !candidate.itemIds.bottom));

  const uncertainWardrobe = demoWardrobe.map((item, index) => ({
    ...item,
    materials: index % 2 ? [] : item.materials,
    styleTags: index % 3 ? item.styleTags : [],
    aiConfidence: { category: 0.35, colors: 0.35, materials: 0.2, pattern: 0.2 },
  }));
  const uncertain = runRecommendationDecision({ wardrobe: uncertainWardrobe, intent: demoIntent, profile: neutral, weather: null, operation: "initial", requestId });
  decisions.push(uncertain);
  fail(failures, "missing-low-confidence", "legal-output", "low-confidence metadata prevented a legal result", uncertain.candidates.length > 0 && uncertain.candidates.every((candidate) => validateOutfit(candidate.itemIds, uncertain.context).valid));

  const contextIntents = [
    { ...demoIntent, activities: [{ label: "Class", timeOfDay: "morning" as const }], aestheticTerms: ["casual"], desiredFormality: 2, photoPriority: 2, walkingIntensity: 4, freeformSummary: "Class and walking" },
    { ...demoIntent, activities: [{ label: "Formal presentation", timeOfDay: "afternoon" as const }], aestheticTerms: ["polished"], desiredFormality: 5, photoPriority: 4, walkingIntensity: 1, freeformSummary: "Formal presentation" },
    { ...demoIntent, activities: [{ label: "Airport travel", timeOfDay: "all_day" as const }], aestheticTerms: ["relaxed"], desiredFormality: 2, photoPriority: 1, walkingIntensity: 5, freeformSummary: "Travel day" },
    { ...demoIntent, activities: [{ label: "Dinner photos", timeOfDay: "evening" as const }], aestheticTerms: ["photo-ready"], desiredFormality: 4, photoPriority: 5, walkingIntensity: 2, freeformSummary: "Dinner and photos" },
    { ...demoIntent, activities: [{ label: "Plans", timeOfDay: "unknown" as const }], aestheticTerms: [], confidence: 0.35, ambiguity: ["Occasion unclear"], freeformSummary: "I am not sure" },
  ];
  const contextDecisions = contextIntents.map((intent, index) => runRecommendationDecision({ wardrobe: demoWardrobe, intent, profile: neutral, weather: null, operation: "initial", requestId: `dddddddd-0000-4000-8000-${String(index).padStart(12, "0")}` }));
  decisions.push(...contextDecisions);
  fail(failures, "context-matrix", "legal-and-traced", "a context scenario was illegal or untraced", contextDecisions.every((decision) => decision.candidates.length > 0 && decision.candidates.every((candidate) => validateOutfit(candidate.itemIds, decision.context).valid && candidate.scoreTrace)));

  const avoidBlack = applyPreferenceDelta({
    profile: neutral,
    now: 2,
    delta: PreferenceDeltaSchema.parse({ action: "add", signalId: null, attribute: "color", value: "black", label: "Black", polarity: "less", strength: "hard", scope: "global_style", categories: [], slots: [], combinationValues: [], confidence: 1, needsReview: false, evidenceSummary: "Never black" }),
  });
  const hardAvoid = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: avoidBlack, weather: null, operation: "initial", requestId });
  decisions.push(hardAvoid);
  fail(failures, "hard-avoid", "black-absent", "hard-avoided black item survived search", hardAvoid.candidates.every((candidate) => Object.values(candidate.itemIds).every((id) => !id || demoWardrobe.find((item) => item.id === id)?.primaryColor !== "black")));

  let conflictCode = "";
  try {
    runRecommendationDecision({ wardrobe: demoWardrobe, intent: { ...demoIntent, requiredItemIds: [required.id], excludedItemIds: [required.id] }, profile: neutral, weather: null, operation: "initial", requestId });
  } catch (error) {
    conflictCode = error instanceof RecommendationError ? error.code : "UNKNOWN";
  }
  fail(failures, "conflicting-required", "accurate-error", `received ${conflictCode}`, conflictCode === "CONFLICTING_REQUIRED_ITEMS");

  const laundryId = demoWardrobe.find((item) => item.category === "shoes")!.id;
  const laundryWardrobe = demoWardrobe.map((item) => item.id === laundryId ? { ...item, availability: "laundry" as const } : item);
  const laundry = runRecommendationDecision({ wardrobe: laundryWardrobe, intent: demoIntent, profile: neutral, weather: null, operation: "initial", requestId });
  decisions.push(laundry);
  fail(failures, "unavailable-laundry", "absent", "laundry item survived search", laundry.candidates.every((candidate) => !Object.values(candidate.itemIds).includes(laundryId)));

  const initial = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: neutral, weather: null, operation: "initial", requestId }).deterministicAnswer;
  const zero = { formality: 0, warmth: 0, comfort: 0, colorfulness: 0, walkingPriority: 0, layering: 0, structure: 0 };
  const revised = runRecommendationDecision({
    wardrobe: demoWardrobe,
    intent: demoIntent,
    profile: neutral,
    weather: null,
    operation: "targeted_revision",
    currentOutfit: initial,
    delta: { operation: "targeted_revision", targetSlots: ["shoes"], preserveSlots: [], requiredItemIds: [], excludedItemIds: [], excludedCategories: [], adjustments: zero, desiredStyleTags: [], undesiredStyleTags: [], temporaryRules: [], rawUtterance: "Change the shoes", confidence: 1, ambiguity: [] },
    requestId,
  });
  decisions.push(revised);
  const nonTargets = (["top", "bottom", "onePiece", "outerwear", "bag", "jewelry", "extraAccessory"] as const);
  const preserved = nonTargets.every((slot) => revised.deterministicAnswer.itemIds[slot] === initial.itemIds[slot]);
  fail(failures, "targeted-shoes", "preservation", "a non-target slot changed", preserved && revised.deterministicAnswer.itemIds.shoes !== initial.itemIds.shoes);

  const warmer = runRecommendationDecision({
    wardrobe: demoWardrobe,
    intent: demoIntent,
    profile: neutral,
    weather: null,
    operation: "global_revision",
    currentOutfit: initial,
    delta: { operation: "global_revision", targetSlots: [], preserveSlots: ["shoes"], requiredItemIds: [], excludedItemIds: [], excludedCategories: [], adjustments: { ...zero, warmth: 0.8 }, desiredStyleTags: [], undesiredStyleTags: [], temporaryRules: [], rawUtterance: "Warmer, keep the shoes", confidence: 1, ambiguity: [] },
    requestId,
  });
  decisions.push(warmer);
  fail(failures, "global-warmer-preserve", "structured-and-preserved", "warmth delta or preserve was lost", warmer.context.intent.warmthBias === 0.8 && warmer.deterministicAnswer.itemIds.shoes === initial.itemIds.shoes);

  const shown = [initial.id];
  let current = initial;
  let repeats = 0;
  const randomSimilarities: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const next = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: neutral, weather: null, operation: "random_new_outfit", currentOutfit: current, shownOutfitIds: shown, requestId: `cccccccc-0000-4000-8000-${String(index).padStart(12, "0")}` }).deterministicAnswer;
    if (shown.includes(next.id)) repeats += 1;
    const context = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: neutral, weather: null, operation: "initial", requestId }).context;
    randomSimilarities.push(outfitSimilarity(current, next, context));
    shown.push(next.id);
    current = next;
  }
  fail(failures, "random-session", "no-repeat-before-exhaustion", `repeat count ${repeats}`, repeats === 0);
  fail(failures, "random-session", "perceptual-distance", `similarities ${randomSimilarities.join(",")}`, randomSimilarities.every((value) => value < 0.9));

  const lessSporty = applyPreferenceDelta({
    profile: neutral,
    now: 2,
    delta: PreferenceDeltaSchema.parse({ action: "add", signalId: null, attribute: "style", value: "sporty", label: "Sporty footwear", polarity: "less", strength: "soft", scope: "category", categories: ["shoes"], slots: ["shoes"], combinationValues: [], confidence: 1, needsReview: false, evidenceSummary: "Less sporty footwear" }),
  });
  const counterfactualWardrobe = [
    demoWardrobe.find((item) => item.category === "top")!,
    demoWardrobe.find((item) => item.category === "bottom")!,
    ...demoWardrobe.filter((item) => item.category === "shoes"),
  ];
  const neutralDecision = runRecommendationDecision({ wardrobe: counterfactualWardrobe, intent: demoIntent, profile: neutral, weather: null, operation: "initial", requestId });
  const lessDecision = runRecommendationDecision({ wardrobe: counterfactualWardrobe, intent: demoIntent, profile: lessSporty, weather: null, operation: "initial", requestId });
  const neutralScores = new Map(neutralDecision.candidates.map((candidate) => [candidate.id, candidate]));
  const scoreDeltas = lessDecision.candidates.map((candidate) => ({
    candidate,
    delta: candidate.deterministicScore - (neutralScores.get(candidate.id)?.deterministicScore ?? candidate.deterministicScore),
  }));
  const sportyDeltas = scoreDeltas.filter(({ candidate }) => counterfactualWardrobe.find((item) => item.id === candidate.itemIds.shoes)?.styleTags.includes("sporty")).map(({ delta }) => delta);
  const otherDeltas = scoreDeltas.filter(({ candidate }) => !counterfactualWardrobe.find((item) => item.id === candidate.itemIds.shoes)?.styleTags.includes("sporty")).map(({ delta }) => delta);
  const preferenceCausal = sportyDeltas.length > 0 && otherDeltas.length > 0 && Math.max(...sportyDeltas) < Math.min(...otherDeltas);
  fail(failures, "less-sporty-footwear", "directional-causality", `sporty deltas ${sportyDeltas}; other deltas ${otherDeltas}`, preferenceCausal);
  const counterfactualStable = lessDecision.candidates.length === neutralDecision.candidates.length
    && lessDecision.candidates.every((candidate) => neutralScores.has(candidate.id))
    && lessDecision.candidates.every((candidate) => candidate.itemIds.top === neutralDecision.candidates[0]?.itemIds.top && candidate.itemIds.bottom === neutralDecision.candidates[0]?.itemIds.bottom);
  fail(failures, "less-sporty-footwear", "non-target-stability", "the isolated counterfactual changed non-shoe structure", counterfactualStable);

  const question = calibrationCatalogV2.questions[0];
  const calibrated = buildCalibrationPreferenceProfile({ direction: "neutral", responses: [createCalibrationResponse(question.id, "a", 2)], now: 3 });
  const fullNeutralDecision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: neutral, weather: null, operation: "initial", requestId });
  const fullNeutralScores = new Map(fullNeutralDecision.candidates.map((candidate) => [candidate.id, candidate]));
  const calibratedDecision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: calibrated, weather: null, operation: "initial", requestId });
  const calibrationCausal = calibratedDecision.candidates.some((candidate) => {
    const neutralCandidate = fullNeutralScores.get(candidate.id);
    return neutralCandidate && Math.abs((candidate.scoreTrace?.dimensions.personalFit ?? 0) - (neutralCandidate.scoreTrace?.dimensions.personalFit ?? 0)) > 0.0001;
  });
  fail(failures, "calibration-anchor", "score-causality", "calibration signals did not alter personalFit", calibrationCausal);

  const fallback = applyVisualRanking({ candidate: rain.deterministicAnswer, visualScore: undefined, reason: "provider unavailable" });
  const fallbackLegal = validateOutfit(fallback.itemIds, rain.context).valid && fallback.source === "fallback";
  const visual = applyVisualRanking({ candidate: rain.deterministicAnswer, visualScore: 0.9, reason: "Visual balance is strong", concerns: [] });
  const expectedVisualTotal = rain.deterministicAnswer.scoreTrace!.deterministicTotal * 0.7 + 0.9 * 0.3;
  const explanationFaithful = visual.reason === visual.scoreTrace?.visualEvidence?.reason
    && Math.abs((visual.scoreTrace?.finalTotal ?? 0) - expectedVisualTotal) < 1e-9
    && decisions.every((decision) => decision.candidates.every((candidate) => Math.abs(weightedTotal(candidate) - candidate.scoreTrace!.deterministicTotal) < 1e-9));
  fail(failures, "visual-and-fallback", "fallback-legality", "fallback was illegal or mislabeled", fallbackLegal);
  fail(failures, "visual-and-fallback", "trace-faithfulness", "trace/reason did not reproduce the chosen score", explanationFaithful);

  const allCandidates = decisions.flatMap((decision) => decision.candidates);
  const hardViolations = decisions.reduce((count, decision) => count + decision.candidates.filter((candidate) => !validateOutfit(candidate.itemIds, decision.context).valid).length, 0);
  const metrics: ReleaseRecommendationMetrics = {
    version: "release-eval-v1",
    scenarioCount: 16,
    candidateCount: allCandidates.length,
    hardConstraintViolationRate: allCandidates.length ? hardViolations / allCandidates.length : 0,
    legalCandidateRecall: legalRecall,
    requiredAnchorSuccessRate: requiredSuccess ? 1 : 0,
    targetedSlotPreservationRate: revised.deterministicAnswer.itemIds.shoes !== initial.itemIds.shoes ? 1 : 0,
    nonTargetStabilityRate: preserved ? 1 : 0,
    duplicateSessionRepeatRate: repeats / 3,
    fallbackLegalityRate: fallbackLegal ? 1 : 0,
    deterministicReproducibilityRate: reproducible ? 1 : 0,
    explanationFaithfulnessRate: explanationFaithful ? 1 : 0,
    personalizationCausalityRate: preferenceCausal ? 1 : 0,
    calibrationCausalityRate: calibrationCausal ? 1 : 0,
    maxExpandedPartials: Math.max(...decisions.map((decision) => decision.diagnostics.expandedPartialCount)),
    maxReturnedCandidates: Math.max(...decisions.map((decision) => decision.candidates.length), large.candidates.length),
  };
  return { metrics, failures };
}
