import {
  DailyIntentSchema,
  type DailyIntent,
  type IntentDelta,
  type Outfit,
  type OutfitSlot,
  type PreferenceProfile,
  type RecommendationOperation,
  type WeatherContext,
  type WardrobeItem,
} from "@/domain/schemas";
import { normalizeSituationProfile, type SituationProfile } from "@/domain/recommendation/situation";

export const recommendationErrorCodes = [
  "NO_LEGAL_OUTFIT",
  "CONFLICTING_REQUIRED_ITEMS",
  "UNKNOWN_ITEM_ID",
  "TARGET_REPLACEMENT_UNAVAILABLE",
  "STRUCTURE_TRANSITION_REQUIRED",
  "INVALID_MODEL_OUTPUT",
  "RANK_PROVIDER_FAILED",
  "BOARD_TOO_LARGE",
  "STALE_OPERATION",
  "PERSISTENCE_FAILED",
] as const;

export type RecommendationErrorCode = (typeof recommendationErrorCodes)[number];

export class RecommendationError extends Error {
  constructor(
    public readonly code: RecommendationErrorCode,
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = "RecommendationError";
  }
}

export type RecommendationContext = {
  intent: DailyIntent;
  profile: PreferenceProfile;
  weather: WeatherContext | null;
  wardrobe: WardrobeItem[];
  wardrobeIndex: Map<string, WardrobeItem>;
  currentOutfit: Outfit | null;
  operation: RecommendationOperation;
  targetSlots: Set<OutfitSlot>;
  preserveSlots: Set<OutfitSlot>;
  requiredEmptySlots: Set<OutfitSlot>;
  requiredItemIds: Set<string>;
  excludedItemIds: Set<string>;
  excludedCategories: Set<WardrobeItem["category"]>;
  desiredStyleTags: Set<string>;
  undesiredStyleTags: Set<string>;
  shownOutfitIds: Set<string>;
  requestId: string;
  operationId: number;
  seed: number;
  situation: SituationProfile;
};

const coreSlots: OutfitSlot[] = ["top", "bottom", "onePiece"];

function clampPriority(value: number) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function clampBias(value: number) {
  return Math.max(-1, Math.min(1, value));
}

export function applyIntentDelta(intent: DailyIntent, delta: IntentDelta): DailyIntent {
  const desiredFormality = clampPriority((intent.desiredFormality ?? 3) + delta.adjustments.formality * 2);
  const temporaryPreferences = [
    ...intent.temporaryPreferences,
    ...delta.desiredStyleTags.map((value) => ({ key: "style", value, strength: "soft" as const, polarity: "prefer" as const })),
    ...delta.undesiredStyleTags.map((value) => ({ key: "style", value, strength: "soft" as const, polarity: "avoid" as const })),
  ];
  return DailyIntentSchema.parse({
    ...intent,
    desiredFormality,
    comfortPriority: clampPriority(intent.comfortPriority + delta.adjustments.comfort * 2),
    walkingIntensity: clampPriority(intent.walkingIntensity + delta.adjustments.walkingPriority * 2),
    warmthBias: clampBias((intent.warmthBias ?? 0) + delta.adjustments.warmth),
    colorfulnessBias: clampBias((intent.colorfulnessBias ?? 0) + delta.adjustments.colorfulness),
    layeringBias: clampBias((intent.layeringBias ?? 0) + delta.adjustments.layering),
    structureBias: clampBias((intent.structureBias ?? 0) + delta.adjustments.structure),
    aestheticTerms: [...new Set([...intent.aestheticTerms, ...delta.desiredStyleTags])].slice(0, 10),
    requiredItemIds: [...new Set([...intent.requiredItemIds, ...delta.requiredItemIds])],
    excludedItemIds: [...new Set([...intent.excludedItemIds, ...delta.excludedItemIds])],
    excludedCategories: [...new Set([...intent.excludedCategories, ...delta.excludedCategories])],
    temporaryPreferences: temporaryPreferences.slice(-24),
    temporaryItemRules: [...(intent.temporaryItemRules ?? []), ...delta.temporaryRules].slice(-24),
    freeformSummary: delta.rawUtterance,
    confidence: delta.confidence,
    ambiguity: delta.ambiguity,
  });
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRecommendationContext(input: {
  wardrobe: WardrobeItem[];
  intent: DailyIntent;
  profile: PreferenceProfile;
  weather: WeatherContext | null;
  currentOutfit?: Outfit | null;
  operation: RecommendationOperation;
  delta?: IntentDelta | null;
  shownOutfitIds?: Iterable<string>;
  requestId?: string;
  operationId?: number;
}): RecommendationContext {
  const requestId = input.requestId ?? crypto.randomUUID();
  const intent = input.delta ? applyIntentDelta(input.intent, input.delta) : DailyIntentSchema.parse(input.intent);
  const wardrobeIndex = new Map(input.wardrobe.map((item) => [item.id, item]));
  const requiredItemIds = new Set(intent.requiredItemIds);
  const excludedItemIds = new Set(intent.excludedItemIds);
  const targetSlots = new Set<OutfitSlot>(input.delta?.targetSlots ?? []);
  const preserveSlots = new Set<OutfitSlot>(input.delta?.preserveSlots ?? []);
  const requiredEmptySlots = new Set<OutfitSlot>(input.delta?.emptySlots ?? []);

  if (input.operation === "targeted_revision" && input.currentOutfit) {
    for (const slot of ["top", "bottom", "onePiece", "outerwear", "shoes", "bag", "jewelry", "extraAccessory"] as OutfitSlot[]) {
      if (!targetSlots.has(slot)) preserveSlots.add(slot);
    }
  }

  const structuralTarget = targetSlots.has("onePiece") || targetSlots.has("top") || targetSlots.has("bottom");
  if (structuralTarget && input.currentOutfit) {
    const changesStructure = (targetSlots.has("onePiece") && !input.currentOutfit.itemIds.onePiece)
      || ((targetSlots.has("top") || targetSlots.has("bottom")) && Boolean(input.currentOutfit.itemIds.onePiece));
    if (changesStructure) {
      for (const slot of coreSlots) preserveSlots.delete(slot);
    }
  }

  for (const id of [...requiredItemIds, ...excludedItemIds]) {
    if (!wardrobeIndex.has(id)) throw new RecommendationError("UNKNOWN_ITEM_ID", "A referenced wardrobe item no longer exists.", [id]);
  }
  for (const id of requiredItemIds) {
    if (excludedItemIds.has(id)) throw new RecommendationError("CONFLICTING_REQUIRED_ITEMS", "The same item cannot be both required and excluded.", [id]);
  }

  return {
    intent,
    profile: input.profile,
    weather: input.weather,
    wardrobe: input.wardrobe,
    wardrobeIndex,
    currentOutfit: input.currentOutfit ?? null,
    operation: input.operation,
    targetSlots,
    preserveSlots,
    requiredEmptySlots,
    requiredItemIds,
    excludedItemIds,
    excludedCategories: new Set(intent.excludedCategories),
    desiredStyleTags: new Set(input.delta?.desiredStyleTags ?? []),
    undesiredStyleTags: new Set(input.delta?.undesiredStyleTags ?? []),
    shownOutfitIds: new Set(input.shownOutfitIds ?? []),
    requestId,
    operationId: input.operationId ?? 0,
    seed: hashSeed(`${requestId}:${input.operationId ?? 0}`),
    situation: normalizeSituationProfile(intent),
  };
}
