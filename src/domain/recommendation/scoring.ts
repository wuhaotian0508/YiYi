import { OutfitSchema, ScoreTraceSchema, type Outfit, type OutfitItemIds, type PreferenceSignal, type ScoreTrace, type StyleVector, type WardrobeItem } from "@/domain/schemas";
import { activeLongTermPreferenceSignals, effectiveStyleProjection } from "@/domain/preferences/profile-mutations";
import { matchesPreferenceSignal, outfitMatchesCombinationSignal } from "@/domain/preferences/preference-matching";
import type { RecommendationContext } from "@/domain/recommendation/context";
import { validateOutfit } from "@/domain/recommendation/constraints";

export const SCORING_VERSION = "constraint-search-v3";
const neutralColors = new Set(["black", "white", "gray", "beige", "brown", "navy"]);
const bodyCategories = new Set<WardrobeItem["category"]>(["top", "bottom", "one_piece", "outerwear"]);
const stableStyleTags = new Set(["classic", "clean", "cool", "delicate", "expressive", "feminine", "minimal", "modern", "polished", "refined", "relaxed", "soft", "sporty", "statement", "tailored", "timeless", "utility"]);

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function mean(values: number[], fallback = 0.5) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function confidence(item: WardrobeItem, feature: keyof WardrobeItem["aiConfidence"]) {
  if (item.userEditedFields.includes(feature)) return 1;
  return item.aiConfidence[feature] ?? 0.72;
}

function desiredWarmth(context: RecommendationContext) {
  if (!context.weather) return clamp01(0.5 + (context.intent.warmthBias ?? 0) * 0.28);
  const apparent = (context.weather.minApparentTempC + context.weather.maxApparentTempC) / 2;
  let target = apparent <= 4 ? 1 : apparent <= 10 ? 0.82 : apparent <= 16 ? 0.66 : apparent <= 22 ? 0.48 : apparent <= 28 ? 0.3 : 0.12;
  if (context.weather.windy) target += 0.08;
  if (context.intent.walkingIntensity >= 4) target -= 0.08;
  return clamp01(target + (context.intent.warmthBias ?? 0) * 0.28);
}

function semanticTokens(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !["and", "with", "more", "less", "look", "looks"].includes(token));
}

const secondaryAccessoryCategories = new Set<WardrobeItem["category"]>(["jewelry", "headwear", "scarf", "belt", "eyewear", "hair_accessory", "other_accessory"]);

/** Maps the finite onboarding vocabulary onto canonical item attributes before generic text matching. */
export function matchesSoftPreference(item: WardrobeItem, preference: string) {
  const value = preference.toLowerCase().trim().replaceAll("-tone", "");
  const tags = new Set(item.styleTags.map((tag) => tag.toLowerCase()));
  const subtype = item.subtype.toLowerCase();
  const materials = item.materials.map((material) => material.toLowerCase());
  const chromatic = !neutralColors.has(item.primaryColor) && item.primaryColor !== "metallic";

  if (value.includes("gold jewelry")) return item.category === "jewelry" && item.metal === "gold";
  if (value.includes("silver jewelry")) return item.category === "jewelry" && item.metal === "silver";
  if (value === "bright colors" || value === "color" || value === "more color") return chromatic || tags.has("colorful") || tags.has("expressive");
  if (value.includes("formal look")) return item.formality >= 4;
  if (value.includes("tight fit")) return item.fit === "slim" || /tight|fitted|bodycon/.test(subtype);
  if (value === "heels" || value.includes("high heel")) return item.category === "shoes" && /heel|pump|stiletto/.test(subtype);
  if (value.includes("cropped top")) return item.category === "top" && (item.fit === "cropped" || subtype.includes("crop"));
  if (value.includes("short skirt")) return item.category === "bottom" && subtype.includes("skirt") && /short|mini/.test(subtype);
  if (value.includes("comfortable shoe")) return item.category === "shoes" && item.comfort >= 4;
  if (value === "relaxed tailoring") return tags.has("tailored") || (tags.has("relaxed") && (tags.has("polished") || item.formality >= 3));
  if (value === "clean layers") return tags.has("clean") || tags.has("layered") || (item.category === "outerwear" && item.formality >= 2);
  if (value === "soft textures") return tags.has("soft") || tags.has("cozy") || materials.some((material) => /knit|cashmere|suede|fleece|jersey/.test(material));
  if (value === "sporty pieces") return tags.has("sporty") || tags.has("athletic");
  if (value === "minimal looks") return tags.has("minimal") || tags.has("clean");
  if (value === "structured pieces") return tags.has("structured") || tags.has("tailored") || /structured|tailored/.test(subtype);
  if (value === "statement accessories") return secondaryAccessoryCategories.has(item.category) && (tags.has("statement") || tags.has("expressive") || subtype.includes("statement"));

  const itemTerms = [...tags, ...semanticTokens(item.subtype), item.primaryColor, item.fit, item.metal].filter((entry): entry is string => Boolean(entry));
  const ruleTerms = semanticTokens(value);
  return itemTerms.some((entry) => ruleTerms.includes(entry) || value.includes(entry) || entry.includes(value));
}

const styleAxes: (keyof StyleVector)[] = ["relaxedPolished", "minimalExpressive", "softCool", "fittedOversized", "classicTrendAware", "feminineNeutral"];

function itemStyleVector(item: WardrobeItem): StyleVector {
  const terms = new Set([...item.styleTags, item.fit, ...semanticTokens(item.subtype)].map((value) => value.toLowerCase()));
  const has = (...values: string[]) => values.some((value) => terms.has(value));
  return {
    relaxedPolished: has("polished", "tailored", "refined") ? 1 : has("relaxed", "casual", "sporty") ? -1 : 0,
    minimalExpressive: has("expressive", "colorful", "statement") ? 1 : has("minimal", "clean") ? -1 : 0,
    softCool: has("cool", "edgy", "utility") ? 1 : has("soft", "cozy", "delicate") ? -1 : 0,
    fittedOversized: has("oversized", "relaxed", "longline") ? 1 : has("slim", "fitted", "cropped") ? -1 : 0,
    classicTrendAware: has("modern", "trend-aware", "statement") ? 1 : has("classic", "timeless") ? -1 : 0,
    feminineNeutral: has("neutral", "utility", "unisex") ? 1 : has("feminine", "delicate") ? -1 : 0,
  };
}

function styleVectorSignal(item: WardrobeItem, context: RecommendationContext, styleVector = effectiveStyleProjection(context.profile).styleVector) {
  const itemVector = itemStyleVector(item);
  return styleAxes.reduce((sum, axis) => sum + itemVector[axis] * styleVector[axis], 0) / styleAxes.length;
}

function positiveCosine(left: StyleVector, right: StyleVector) {
  const dot = styleAxes.reduce((sum, axis) => sum + left[axis] * right[axis], 0);
  const leftNorm = Math.sqrt(styleAxes.reduce((sum, axis) => sum + left[axis] ** 2, 0));
  const rightNorm = Math.sqrt(styleAxes.reduce((sum, axis) => sum + right[axis] ** 2, 0));
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(0, dot / (leftNorm * rightNorm));
}

function rejectedStyleLookSimilarity(items: readonly WardrobeItem[], signal: PreferenceSignal) {
  if (!signal.semanticVector || signal.attribute !== "style_look" || signal.polarity !== "less") return 0;
  const vectors = items.map(itemStyleVector);
  const outfitVector = Object.fromEntries(styleAxes.map((axis) => [axis, mean(vectors.map((vector) => vector[axis]), 0)])) as StyleVector;
  const vectorSimilarity = positiveCosine(outfitVector, signal.semanticVector);
  const outfitTags = new Set(items.flatMap((item) => item.styleTags.map((tag) => tag.toLowerCase())));
  const signalTags = signal.styleTags.map((tag) => tag.toLowerCase());
  const tagOverlap = signalTags.length ? signalTags.filter((tag) => outfitTags.has(tag)).length / signalTags.length : 0;
  return clamp01(vectorSimilarity * 0.8 + tagOverlap * 0.2);
}

function colorCompatibility(items: WardrobeItem[]) {
  const colors = items.map((item) => item.primaryColor);
  const nonNeutral = colors.filter((color) => !neutralColors.has(color) && color !== "metallic");
  const unique = new Set(colors);
  let score = 0.82;
  if (nonNeutral.length <= 1) score += 0.1;
  if (nonNeutral.length >= 3) score -= 0.18;
  if (unique.size === 1 && items.length >= 4) score -= 0.08;
  if (colors.includes("brown") && colors.includes("black")) score -= 0.02;
  return clamp01(score);
}

function patternCompatibility(items: WardrobeItem[]) {
  const patterned = items.filter((item) => !["solid", "textured", "unknown"].includes(item.pattern));
  if (patterned.length === 0) return 0.84;
  if (patterned.length === 1) return 0.92;
  const patterns = new Set(patterned.map((item) => item.pattern));
  return patterns.size === 1 ? 0.72 : 0.58;
}

function materialCompatibility(items: WardrobeItem[]) {
  const materials = items.flatMap((item) => item.materials.map((value) => value.toLowerCase()));
  const heavy = materials.filter((value) => /wool|leather|denim|suede/.test(value)).length;
  const light = materials.filter((value) => /linen|silk|chiffon/.test(value)).length;
  const confidenceWeight = mean(items.map((item) => confidence(item, "materials")));
  const mismatch = heavy >= 2 && light >= 2 ? 0.18 : 0;
  return clamp01((0.84 - mismatch) * confidenceWeight + 0.5 * (1 - confidenceWeight));
}

function silhouetteCompatibility(items: WardrobeItem[]) {
  const core = items.filter((item) => ["top", "bottom", "one_piece", "outerwear"].includes(item.category));
  const oversized = core.filter((item) => item.fit === "oversized").length;
  const slim = core.filter((item) => item.fit === "slim").length;
  let score = 0.82;
  if (oversized >= 3) score -= 0.22;
  if (oversized === 1 && slim >= 1) score += 0.08;
  if (core.some((item) => item.fit === "cropped") && core.some((item) => item.fit === "longline")) score += 0.04;
  return clamp01(score);
}

function accessoryCompatibility(items: WardrobeItem[], context: RecommendationContext) {
  const bag = items.find((item) => item.category === "bag");
  const shoes = items.find((item) => item.category === "shoes");
  const metals = items.filter((item) => item.metal && item.metal !== "none" && item.metal !== "unknown").map((item) => item.metal);
  let score = 0.85;
  if (bag && shoes) score -= Math.min(0.18, Math.abs(bag.formality - shoes.formality) * 0.045);
  if (new Set(metals).size > 1 && !metals.includes("mixed")) score -= 0.08;
  const legacyPreferredMetals = context.profile.preferenceSignals === undefined ? context.profile.preferredMetals : [];
  if (legacyPreferredMetals.length && metals.length && metals.some((metal) => metal && !legacyPreferredMetals.includes(metal as "gold" | "silver" | "mixed"))) score -= 0.08;
  const accessoryCount = items.filter((item) => ["bag", "jewelry", "headwear", "scarf", "belt", "eyewear", "hair_accessory", "other_accessory"].includes(item.category)).length;
  if (accessoryCount >= 3) score -= 0.12;
  else if (accessoryCount === 2) score -= 0.03;
  return clamp01(score);
}

function itemStyleSignal(item: WardrobeItem, context: RecommendationContext) {
  const tags = new Set(item.styleTags.map((tag) => tag.toLowerCase()));
  const styleProjection = effectiveStyleProjection(context.profile);
  let score = styleVectorSignal(item, context, styleProjection.styleVector) * 0.32;
  for (const term of context.intent.aestheticTerms) if (tags.has(term.toLowerCase())) score += 0.16;
  for (const tag of context.desiredStyleTags) if (tags.has(tag)) score += 0.2;
  for (const tag of context.undesiredStyleTags) if (tags.has(tag)) score -= 0.24;
  const canonicalSignals = context.profile.preferenceSignals === undefined
    ? null
    : activeLongTermPreferenceSignals(context.profile);
  for (const signal of canonicalSignals ?? []) {
    if (matchesPreferenceSignal(item, signal)) score += (signal.polarity === "less" ? -1 : 1) * 0.28 * signal.confidence;
  }
  const durableRules = canonicalSignals === null ? context.profile.softPreferences : [];
  for (const rule of [...durableRules, ...context.intent.temporaryPreferences]) {
    if (rule.key.endsWith("note")) continue;
    if (matchesSoftPreference(item, rule.value)) score += (rule.polarity === "avoid" ? -1 : 1) * 0.28;
  }
  for (const rule of context.intent.temporaryItemRules ?? []) {
    if (rule.strength === "hard") continue;
    if (rule.categories.length && !rule.categories.includes(item.category)) continue;
    const slot = item.category === "one_piece" ? "onePiece" : ["headwear", "scarf", "belt", "eyewear", "hair_accessory", "other_accessory"].includes(item.category) ? "extraAccessory" : item.category;
    if (rule.slots.length && !rule.slots.includes(slot as "top" | "bottom" | "onePiece" | "outerwear" | "shoes" | "bag" | "jewelry" | "extraAccessory")) continue;
    const values = rule.key === "color" ? [item.primaryColor, ...item.secondaryColors]
      : rule.key === "material" ? item.materials
      : rule.key === "style" ? item.styleTags
      : rule.key === "fit" ? [item.fit]
      : rule.key === "metal" ? [item.metal ?? "unknown"]
      : rule.key === "category" ? [item.category]
      : [item.subtype];
    if (values.some((value) => value.toLowerCase().includes(rule.value) || rule.value.includes(value.toLowerCase()))) score += (rule.polarity === "avoid" ? -1 : 1) * 0.3;
  }
  for (const anchor of styleProjection.styleAnchors) {
    for (const tag of tags) score += (anchor.styleTags[tag] ?? 0) * anchor.confidence * 0.12;
  }
  return score * confidence(item, "style");
}

function outfitPreferenceAdjustment(items: WardrobeItem[], context: RecommendationContext) {
  if (context.profile.preferenceSignals === undefined) return 0;
  const activeSignals = activeLongTermPreferenceSignals(context.profile);
  const combinationAdjustment = activeSignals
    .filter((signal) => signal.attribute === "combination" && signal.strength === "soft")
    .reduce((score, signal) => {
      if (!outfitMatchesCombinationSignal(items, signal)) return score;
      return score + (signal.polarity === "less" ? -1 : 1) * 0.22 * signal.confidence;
    }, 0);
  const rejectedStylePenalty = activeSignals
    .filter((signal) => signal.attribute === "style_look" && signal.polarity === "less")
    .reduce((penalty, signal) => penalty + rejectedStyleLookSimilarity(items, signal) * signal.confidence * 0.14, 0);
  return combinationAdjustment - Math.min(0.24, rejectedStylePenalty);
}

export function scoreItemHeuristic(item: WardrobeItem, context: RecommendationContext) {
  const formalityTarget = clamp01(((context.intent.desiredFormality ?? 3) + context.profile.formalityBias) / 5) * 5;
  const formalityFit = 1 - Math.abs(item.formality - formalityTarget) / 4;
  const comfort = item.comfort / 5;
  const warmthFit = bodyCategories.has(item.category) || item.category === "shoes" || item.category === "headwear" || item.category === "scarf"
    ? 1 - Math.abs(item.warmth / 5 - desiredWarmth(context))
    : 0.7;
  const walking = item.category === "shoes" ? item.comfort / 5 : 0.7;
  const style = clamp01(0.5 + itemStyleSignal(item, context));
  return clamp01(formalityFit * 0.25 + comfort * 0.2 + warmthFit * 0.18 + walking * 0.09 + style * 0.28);
}

export function scorePartialCompatibility(existingIds: Iterable<string>, next: WardrobeItem, context: RecommendationContext) {
  const existing = [...existingIds].map((id) => context.wardrobeIndex.get(id)).filter((item): item is WardrobeItem => Boolean(item));
  if (!existing.length) return 0.7;
  const pairScores = existing.map((item) => {
    const color = colorCompatibility([item, next]);
    const formality = 1 - Math.min(1, Math.abs(item.formality - next.formality) / 4);
    const styles = new Set(item.styleTags);
    const styleOverlap = next.styleTags.some((tag) => styles.has(tag)) ? 1 : 0.62;
    const silhouette = silhouetteCompatibility([item, next]);
    return color * 0.34 + formality * 0.28 + styleOverlap * 0.2 + silhouette * 0.18;
  });
  return clamp01(mean(pairScores));
}

export function normalizedWeightsFor(context: RecommendationContext) {
  const weights = {
    contextFit: 0.26,
    personalFit: 0.28,
    structuredCompatibility: 0.18,
    comfortPracticality: 0.14,
    novelty: 0.08,
  };
  if (context.intent.walkingIntensity >= 4 || context.intent.comfortPriority >= 4) {
    weights.comfortPracticality += 0.08;
    weights.contextFit -= 0.04;
    weights.personalFit -= 0.04;
  }
  const comfortShift = (context.profile.comfortWeight - 0.5) * 0.12;
  weights.comfortPracticality += comfortShift;
  weights.personalFit -= comfortShift;
  if (context.operation === "targeted_revision") {
    weights.novelty -= 0.02;
    weights.structuredCompatibility += 0.01;
    weights.personalFit += 0.01;
  }
  if (context.operation === "random_new_outfit") {
    weights.novelty += 0.16;
    weights.contextFit -= 0.06;
    weights.personalFit -= 0.04;
    weights.structuredCompatibility -= 0.06;
  }
  if (context.intent.photoPriority >= 4) {
    weights.structuredCompatibility += 0.06;
    weights.comfortPracticality -= 0.03;
    weights.novelty -= 0.03;
  }
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0);
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Math.max(0, value) / total])) as typeof weights;
}

function occasionCompatibility(item: WardrobeItem, context: RecommendationContext) {
  const text = context.intent.activities.map((activity) => activity.label.toLowerCase()).join(" ");
  const desired = new Set<string>();
  if (/office|work|meeting|presentation/.test(text)) desired.add("work");
  if (/dinner|date|restaurant/.test(text)) { desired.add("dinner"); desired.add("evening"); }
  if (/gallery|museum|creative/.test(text)) { desired.add("gallery"); desired.add("creative"); }
  if (/walk|errand|casual|coffee/.test(text)) { desired.add("casual"); desired.add("everyday"); }
  if (/party|wedding|event/.test(text)) { desired.add("event"); desired.add("formal"); }
  if (/travel|flight|airport/.test(text)) desired.add("travel");
  if (item.occasionTags.some((tag) => desired.has(tag))) return 1;
  if (item.occasionTags.includes("everyday")) return 0.78;
  return 0.65;
}

function recencyScore(items: WardrobeItem[], context: RecommendationContext, outfitId: string) {
  const now = Date.now();
  const itemNovelty = mean(items.map((item) => {
    if (!item.lastWornAt || context.requiredItemIds.has(item.id)) return 1;
    const days = Math.max(0, (now - item.lastWornAt) / 86_400_000);
    if (days < 2) return 0.15;
    if (days < 7) return 0.5;
    if (days < 21) return 0.82;
    return 1;
  }));
  if (context.shownOutfitIds.has(outfitId)) return itemNovelty * 0.2;
  return itemNovelty;
}

export function stableOutfitId(ids: OutfitItemIds) {
  const ordered = (["top", "bottom", "onePiece", "outerwear", "shoes", "bag", "jewelry", "extraAccessory"] as const)
    .map((slot) => `${slot}:${ids[slot] ?? "-"}`).join("|");
  let hash = 2166136261;
  for (const character of ordered) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  const suffix = (hash >>> 0).toString(16).padStart(12, "0").slice(0, 12);
  return `00000000-0000-4000-8000-${suffix}`;
}

function thermalWeight(item: WardrobeItem) {
  if (item.category === "one_piece") return 0.9;
  if (item.category === "top") return 0.5;
  if (item.category === "bottom") return 0.35;
  if (item.category === "outerwear") return 0.65;
  if (item.category === "shoes") return 0.08;
  if (item.category === "headwear" || item.category === "scarf") return 0.12;
  return 0;
}

export function outfitThermalPerformance(ids: OutfitItemIds, context: RecommendationContext) {
  const items = Object.values(ids).map((id) => context.wardrobeIndex.get(id)).filter((item): item is WardrobeItem => Boolean(item));
  const thermal = items.map((item) => ({ value: item.warmth / 5, weight: thermalWeight(item) })).filter((entry) => entry.weight > 0);
  if (!thermal.length) return 0.5;
  const totalWeight = thermal.reduce((sum, entry) => sum + entry.weight, 0);
  return clamp01(thermal.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight);
}

export function outfitComfortPerformance(ids: OutfitItemIds, context: RecommendationContext) {
  const items = Object.values(ids).map((id) => context.wardrobeIndex.get(id)).filter((item): item is WardrobeItem => Boolean(item));
  const worn = items.filter((item) => bodyCategories.has(item.category) || item.category === "shoes");
  const shoe = items.find((item) => item.category === "shoes");
  return clamp01(mean(worn.map((item) => item.comfort / 5)) * 0.62 + (shoe ? shoe.comfort / 5 : 0) * 0.38);
}

export function scoreCandidate(ids: OutfitItemIds, context: RecommendationContext): Outfit {
  const validation = validateOutfit(ids, context);
  if (!validation.valid) throw new Error(`Cannot score illegal outfit: ${validation.violations.map((entry) => entry.code).join(",")}`);
  const items = Object.values(ids).map((id) => context.wardrobeIndex.get(id)).filter((item): item is WardrobeItem => Boolean(item));
  const targetFormality = Math.max(1, Math.min(5, (context.intent.desiredFormality ?? 3) + context.profile.formalityBias));
  const outfitWarmth = outfitThermalPerformance(ids, context);
  const weatherFit = 1 - Math.abs(outfitWarmth - desiredWarmth(context));
  const formalityFit = 1 - Math.abs(mean(items.map((item) => item.formality)) - targetFormality) / 4;
  const occasionFit = mean(items.map((item) => occasionCompatibility(item, context)));
  const colorfulShare = mean(items.map((item) => neutralColors.has(item.primaryColor) || item.primaryColor === "metallic" ? 0 : 1), 0);
  const colorfulnessTarget = clamp01(0.35 + (context.intent.colorfulnessBias ?? 0) * 0.35);
  const colorfulnessFit = 1 - Math.abs(colorfulShare - colorfulnessTarget);
  const layeringFit = context.intent.layeringBias === undefined || context.intent.layeringBias === 0
    ? 0.75
    : context.intent.layeringBias > 0 ? (ids.outerwear ? 1 : 0.25) : (ids.outerwear ? 0.35 : 1);
  const structuredShare = mean(items.filter((item) => ["top", "bottom", "one_piece", "outerwear"].includes(item.category)).map((item) => item.fit === "slim" || item.styleTags.some((tag) => ["tailored", "polished", "structured"].includes(tag)) ? 1 : 0.25));
  const structureTarget = clamp01(0.5 + (context.intent.structureBias ?? 0) * 0.4);
  const structureFit = 1 - Math.abs(structuredShare - structureTarget);
  const contextFit = clamp01(weatherFit * 0.36 + formalityFit * 0.27 + occasionFit * 0.15 + colorfulnessFit * 0.1 + layeringFit * 0.06 + structureFit * 0.06);

  const personalFit = clamp01(0.5 + mean(items.map((item) => itemStyleSignal(item, context)), 0) + outfitPreferenceAdjustment(items, context));
  const formalitySpread = Math.max(...items.map((item) => item.formality)) - Math.min(...items.map((item) => item.formality));
  const structuredCompatibility = clamp01(
    colorCompatibility(items) * 0.31
    + silhouetteCompatibility(items) * 0.21
    + materialCompatibility(items) * 0.17
    + patternCompatibility(items) * 0.1
    + accessoryCompatibility(items, context) * 0.11
    + (1 - Math.min(1, formalitySpread / 4)) * 0.1,
  );
  const shoe = items.find((item) => item.category === "shoes");
  const walking = shoe ? shoe.comfort / 5 : 0;
  const comfortPracticality = outfitComfortPerformance(ids, context);
  const outfitId = stableOutfitId(ids);
  const novelty = recencyScore(items, context, outfitId);
  const dimensions = { contextFit, personalFit, structuredCompatibility, comfortPracticality, novelty };
  const weights = normalizedWeightsFor(context);
  const deterministicTotal = clamp01(Object.entries(weights).reduce((sum, [key, weight]) => sum + dimensions[key as keyof typeof dimensions] * weight, 0));
  const positives: string[] = [];
  const tradeoffs: string[] = [];
  if (context.weather && weatherFit >= 0.78) positives.push(context.weather.expectedRain ? "Avoids dry-only pieces in expected rain" : "Balanced for today’s temperature");
  if (walking >= 0.8 && context.intent.walkingIntensity >= 4) positives.push("Comfortable for extended walking");
  if (personalFit >= 0.62) positives.push("Aligned with your saved style signals");
  if (structuredCompatibility >= 0.78) positives.push("Cohesive color, proportion, and formality");
  if (novelty < 0.5) tradeoffs.push("Uses pieces shown or worn recently");
  const traceItemIds = Object.values(ids).filter((id): id is string => Boolean(id));
  const hardConstraintChecks = [
    { rule: "core-structure:exactly-one-template", passed: true, itemIds: traceItemIds },
    { rule: `availability:${traceItemIds.length}-items-current`, passed: true, itemIds: traceItemIds },
    ...(context.excludedItemIds.size ? [{ rule: `excluded-items:${context.excludedItemIds.size}`, passed: true, itemIds: [...context.excludedItemIds] }] : []),
    ...(context.excludedCategories.size ? [{ rule: `excluded-categories:${[...context.excludedCategories].join(",")}`, passed: true, itemIds: traceItemIds }] : []),
    ...(context.requiredItemIds.size ? [{ rule: `required-items:${context.requiredItemIds.size}`, passed: true, itemIds: [...context.requiredItemIds] }] : []),
    ...(context.weather?.expectedRain ? [{ rule: "weather:expected-rain-no-dry-only", passed: true, itemIds: traceItemIds }] : []),
    ...(context.preserveSlots.size ? [{ rule: `preserved-slots:${[...context.preserveSlots].join(",")}`, passed: true, itemIds: traceItemIds }] : []),
  ];
  const trace: ScoreTrace = ScoreTraceSchema.parse({
    dimensions,
    weights,
    hardConstraintChecks,
    positives,
    tradeoffs,
    warnings: [...(context.intent.confidence !== undefined && context.intent.confidence < 0.65 ? ["Intent confidence is limited"] : []), ...(context.intent.ambiguity?.map((entry) => `Ambiguity: ${entry}`) ?? [])].slice(0, 8),
    deterministicTotal,
    scoringVersion: SCORING_VERSION,
  });
  const reason = positives.length >= 2 ? `${positives[0]}, with ${positives[1].toLowerCase()}.` : positives[0] ?? "A legal, cohesive answer for today.";
  return OutfitSchema.parse({ id: outfitId, itemIds: ids, deterministicScore: Number((deterministicTotal * 100).toFixed(2)), reason, scoreTrace: trace, source: "deterministic" });
}

function jaccard<T>(a: Set<T>, b: Set<T>) {
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  return [...a].filter((value) => b.has(value)).length / union.size;
}

export function outfitSimilarity(a: Outfit, b: Outfit, context?: RecommendationContext) {
  const aIds = new Set(Object.values(a.itemIds).filter(Boolean));
  const bIds = Object.values(b.itemIds).filter((id): id is string => Boolean(id));
  const shared = bIds.filter((id) => aIds.has(id)).length;
  const union = new Set([...aIds, ...bIds]).size;
  const sameStructure = Boolean(a.itemIds.onePiece) === Boolean(b.itemIds.onePiece) ? 1 : 0;
  if (!context) return clamp01((union ? shared / union : 0) * 0.85 + sameStructure * 0.15);
  const features = (outfit: Outfit) => {
    const items = Object.values(outfit.itemIds).map((id) => context.wardrobeIndex.get(id)).filter((item): item is WardrobeItem => Boolean(item));
    return {
      colors: new Set(items.map((item) => item.primaryColor)),
      styles: new Set(items.flatMap((item) => item.styleTags.filter((tag) => stableStyleTags.has(tag)))),
      fits: new Set(items.filter((item) => bodyCategories.has(item.category)).map((item) => item.fit)),
      formality: mean(items.map((item) => item.formality / 5)),
    };
  };
  const af = features(a);
  const bf = features(b);
  return clamp01(
    (union ? shared / union : 0) * 0.44
    + sameStructure * 0.1
    + jaccard(af.colors, bf.colors) * 0.16
    + jaccard(af.styles, bf.styles) * 0.14
    + jaccard(af.fits, bf.fits) * 0.08
    + (1 - Math.abs(af.formality - bf.formality)) * 0.08,
  );
}
