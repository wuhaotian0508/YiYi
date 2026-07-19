import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import {
  OutfitSchema,
  type DailyIntent,
  type IntentDelta,
  type Outfit,
  type OutfitVersion,
  type PreferenceProfile,
  type RecommendationOperation,
  type WeatherContext,
  type WardrobeItem,
} from "@/domain/schemas";
import { createRecommendationContext, type RecommendationContext } from "@/domain/recommendation/context";
import { validateOutfit } from "@/domain/recommendation/constraints";
import { generateLegalCandidates, selectDeterministicAnswer, selectDiverseCandidates, type SearchDiagnostics } from "@/domain/recommendation/search";

export type RecommendationDecision = {
  context: RecommendationContext;
  candidates: Outfit[];
  rankingCandidates: Outfit[];
  deterministicAnswer: Outfit;
  diagnostics: SearchDiagnostics;
};

export function runRecommendationDecision(input: {
  wardrobe: WardrobeItem[];
  intent: DailyIntent;
  profile: PreferenceProfile;
  weather: WeatherContext | null;
  operation: RecommendationOperation;
  currentOutfit?: Outfit | null;
  delta?: IntentDelta | null;
  shownOutfitIds?: Iterable<string>;
  requestId?: string;
  operationId?: number;
}): RecommendationDecision {
  const context = createRecommendationContext(input);
  const search = generateLegalCandidates(context);
  const candidates = search.candidates.map((candidate) => OutfitSchema.parse({
    ...candidate,
    scoreTrace: candidate.scoreTrace ? {
      ...candidate.scoreTrace,
      searchDiagnostics: {
        expandedPartialCount: search.diagnostics.expandedPartialCount,
        finalLegalCount: search.diagnostics.finalLegalCount,
        rejectionCounts: search.diagnostics.rejectionCounts,
      },
    } : undefined,
  }));
  const deterministicAnswer = selectDeterministicAnswer(candidates, context);
  if (!deterministicAnswer) throw new Error("Candidate search returned no selectable answer");
  let rankingPool = candidates.filter((candidate) => candidate.id !== context.currentOutfit?.id);
  if (context.operation === "random_new_outfit") {
    const unseen = rankingPool.filter((candidate) => !context.shownOutfitIds.has(candidate.id));
    if (unseen.length) rankingPool = unseen;
  }
  return {
    context,
    candidates,
    rankingCandidates: selectDiverseCandidates(rankingPool.length ? rankingPool : [deterministicAnswer], context, 6),
    deterministicAnswer,
    diagnostics: search.diagnostics,
  };
}

/** Compatibility entry point for simple render/tests; it still uses the canonical pipeline. */
export function generateCandidates(wardrobe: WardrobeItem[], intent: DailyIntent, limit = 8, context?: { weather?: WeatherContext | null; profile?: PreferenceProfile }) {
  return runRecommendationDecision({
    wardrobe,
    intent,
    profile: context?.profile ?? createNeutralPreferenceProfile(),
    weather: context?.weather ?? null,
    operation: "initial",
    requestId: "00000000-0000-4000-8000-000000000001",
  }).candidates.slice(0, limit);
}

export function changedAndPreserved(before: Outfit, after: Outfit) {
  const beforeIds = Object.values(before.itemIds).filter((id): id is string => Boolean(id));
  const afterIds = Object.values(after.itemIds).filter((id): id is string => Boolean(id));
  return {
    changedItemIds: [...beforeIds.filter((id) => !afterIds.includes(id)), ...afterIds.filter((id) => !beforeIds.includes(id))],
    preservedItemIds: beforeIds.filter((id) => afterIds.includes(id)),
  };
}

export function validateSelectedId(candidateIds: string[], selectedId: string) {
  return candidateIds.includes(selectedId);
}

export function validateRankingReferences(candidateIds: string[], selectedId: string, scoreIds: string[]) {
  return validateSelectedId(candidateIds, selectedId)
    && scoreIds.length === candidateIds.length
    && scoreIds.every((id) => validateSelectedId(candidateIds, id))
    && scoreIds.includes(selectedId)
    && new Set(scoreIds).size === scoreIds.length
    && candidateIds.every((id) => scoreIds.includes(id));
}

export function applyVisualRanking(input: {
  candidate: Outfit;
  visualScore: number | undefined;
  reason: string;
  concerns?: string[];
}) {
  const deterministic = input.candidate.scoreTrace?.deterministicTotal ?? input.candidate.deterministicScore / 100;
  const finalTotal = input.visualScore === undefined ? deterministic : deterministic * 0.7 + input.visualScore * 0.3;
  return OutfitSchema.parse({
    ...input.candidate,
    reason: input.visualScore === undefined ? input.candidate.reason || input.reason : input.reason,
    source: input.visualScore === undefined ? "fallback" : "visual",
    deterministicScore: Number((finalTotal * 100).toFixed(2)),
    scoreTrace: input.candidate.scoreTrace ? {
      ...input.candidate.scoreTrace,
      dimensions: { ...input.candidate.scoreTrace.dimensions, ...(input.visualScore === undefined ? {} : { visualScore: input.visualScore }) },
      ...(input.visualScore === undefined ? {} : { visualEvidence: { reason: input.reason, concerns: input.concerns ?? [] } }),
      finalTotal,
    } : undefined,
  });
}

export function assertDisplayedOutfitLegal(outfit: Outfit, context: RecommendationContext) {
  const validation = validateOutfit(outfit.itemIds, context);
  if (!validation.valid) throw new Error(`Displayed outfit failed canonical validation: ${validation.violations.map((entry) => entry.code).join(",")}`);
}

export function validateRestoredOutfit(input: {
  version: OutfitVersion;
  wardrobe: WardrobeItem[];
  intent: DailyIntent;
  profile: PreferenceProfile;
  weather: WeatherContext | null;
}) {
  try {
    const context = createRecommendationContext({ wardrobe: input.wardrobe, intent: input.intent, profile: input.profile, weather: input.weather, operation: "fallback" });
    const validation = validateOutfit(input.version.outfit.itemIds, context);
    return { valid: validation.valid, reasons: validation.violations.map((violation) => violation.code), context };
  } catch (error) {
    return { valid: false, reasons: [error instanceof Error ? error.name : "RESTORE_CONTEXT_INVALID"], context: null };
  }
}
