import { OutfitSchema, type DailyIntent, type Outfit, type OutfitItemIds, type WeatherContext, type WardrobeItem } from "@/domain/schemas";

const accessoryCategories: WardrobeItem["category"][] = ["headwear", "scarf", "belt", "eyewear", "hair_accessory", "other_accessory"];

function byCategory(items: WardrobeItem[], category: WardrobeItem["category"]) {
  return items.filter((item) => item.category === category);
}

function scoreItem(item: WardrobeItem, intent: DailyIntent) {
  const formalityTarget = intent.desiredFormality ?? 3;
  const formality = 5 - Math.abs(item.formality - formalityTarget);
  const comfort = item.comfort * (intent.comfortPriority / 5);
  const walking = item.category === "shoes" && intent.walkingIntensity >= 4 ? item.comfort * 1.5 : 0;
  const style = item.styleTags.some((tag) => intent.aestheticTerms.includes(tag)) ? 2 : 0;
  const recency = item.lastWornAt ? -0.5 : 0;
  return formality + comfort + walking + style + recency;
}

function uniqueId(parts: string[]) {
  let hash = 2166136261;
  for (const character of parts.join("|")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = Math.abs(hash).toString(16).padStart(12, "0").slice(0, 12);
  return `00000000-0000-4000-8000-${suffix}`;
}

function outfitScore(ids: OutfitItemIds, lookup: Map<string, WardrobeItem>, intent: DailyIntent) {
  const values = Object.values(ids).filter((id): id is string => Boolean(id));
  return Number(values.reduce((sum, id) => sum + scoreItem(lookup.get(id)!, intent), 0).toFixed(2));
}

export function generateCandidates(wardrobe: WardrobeItem[], intent: DailyIntent, limit = 8, context?: { weather?: WeatherContext | null }): Outfit[] {
  const legal = wardrobe.filter((item) =>
    item.availability === "available" &&
    !intent.excludedCategories.includes(item.category) &&
    !intent.excludedItemIds.includes(item.id) &&
    !(context?.weather?.expectedRain && item.weatherTags.includes("dry_only")),
  );
  const lookup = new Map(legal.map((item) => [item.id, item]));
  const tops = byCategory(legal, "top").sort((a, b) => scoreItem(b, intent) - scoreItem(a, intent)).slice(0, 4);
  const bottoms = byCategory(legal, "bottom").sort((a, b) => scoreItem(b, intent) - scoreItem(a, intent)).slice(0, 4);
  const onePieces = byCategory(legal, "one_piece").sort((a, b) => scoreItem(b, intent) - scoreItem(a, intent)).slice(0, 4);
  const shoes = byCategory(legal, "shoes")
    .filter((shoe) => intent.walkingIntensity < 4 || shoe.comfort >= 3)
    .sort((a, b) => scoreItem(b, intent) - scoreItem(a, intent)).slice(0, 4);
  const outerwear = byCategory(legal, "outerwear").sort((a, b) => scoreItem(b, intent) - scoreItem(a, intent)).slice(0, 3);
  const bags = byCategory(legal, "bag").sort((a, b) => scoreItem(b, intent) - scoreItem(a, intent)).slice(0, 2);
  const jewelry = byCategory(legal, "jewelry").sort((a, b) => scoreItem(b, intent) - scoreItem(a, intent)).slice(0, 2);
  const idsList: OutfitItemIds[] = [];

  for (const top of tops) for (const bottom of bottoms) for (const shoe of shoes) {
    const index = idsList.length;
    idsList.push({
      top: top.id,
      bottom: bottom.id,
      shoes: shoe.id,
      outerwear: outerwear[index % Math.max(outerwear.length, 1)]?.id,
      bag: bags[index % Math.max(bags.length, 1)]?.id,
      jewelry: jewelry[index % Math.max(jewelry.length, 1)]?.id,
    });
  }

  for (const onePiece of onePieces) for (const shoe of shoes) {
    idsList.push({ onePiece: onePiece.id, shoes: shoe.id, outerwear: outerwear[0]?.id, bag: bags[0]?.id });
  }

  const candidates = idsList
    .filter((ids) => intent.requiredItemIds.every((id) => Object.values(ids).includes(id)))
    .map((ids) => OutfitSchema.parse({
      id: uniqueId(Object.values(ids).filter((id): id is string => Boolean(id))),
      itemIds: ids,
      deterministicScore: outfitScore(ids, lookup, intent),
      reason: "Comfortable, cohesive, and ready for the day.",
    }))
    .sort((a, b) => b.deterministicScore - a.deterministicScore);

  const diverse: Outfit[] = [];
  for (const candidate of candidates) {
    const core = new Set([candidate.itemIds.top, candidate.itemIds.bottom, candidate.itemIds.onePiece, candidate.itemIds.outerwear, candidate.itemIds.shoes].filter(Boolean));
    const differentEnough = diverse.every((chosen) => {
      const chosenCore = [chosen.itemIds.top, chosen.itemIds.bottom, chosen.itemIds.onePiece, chosen.itemIds.outerwear, chosen.itemIds.shoes].filter(Boolean);
      return chosenCore.filter((id) => !core.has(id)).length >= 2;
    });
    if (differentEnough || diverse.length === 0) diverse.push(candidate);
    if (diverse.length === limit) break;
  }
  return diverse.length >= 3 ? diverse : candidates.slice(0, limit);
}

export type RevisionTarget = keyof OutfitItemIds | "overall";

export function reviseTargeted(
  current: Outfit,
  target: Exclude<RevisionTarget, "overall">,
  wardrobe: WardrobeItem[],
  intent: DailyIntent,
  request = "",
): Outfit {
  const categoryForTarget: Record<Exclude<RevisionTarget, "overall">, WardrobeItem["category"][]> = {
    top: ["top"], bottom: ["bottom"], onePiece: ["one_piece"], outerwear: ["outerwear"], shoes: ["shoes"],
    bag: ["bag"], jewelry: ["jewelry"], extraAccessory: accessoryCategories,
  };
  const currentId = current.itemIds[target];
  const normalizedRequest = request.toLowerCase();
  if (["bag", "jewelry", "extraAccessory", "outerwear"].includes(target) && /\b(no|remove|without|skip)\b/.test(normalizedRequest) && currentId) {
    const itemIds = { ...current.itemIds };
    delete itemIds[target];
    return OutfitSchema.parse({
      ...current,
      id: uniqueId(Object.values(itemIds).filter((id): id is string => Boolean(id))),
      itemIds,
      deterministicScore: current.deterministicScore,
      reason: "Done. Everything else stayed the same.",
    });
  }
  const replacements = wardrobe
    .filter((item) => categoryForTarget[target].includes(item.category) && item.availability === "available" && item.id !== currentId)
    .filter((item) => target !== "shoes" || intent.walkingIntensity < 4 || item.comfort >= 3)
    .sort((a, b) => {
      const requestMatch = (item: WardrobeItem) => [item.metal, item.primaryColor, item.subtype, ...item.styleTags].filter(Boolean).some((value) => normalizedRequest.includes(String(value).toLowerCase())) ? 4 : 0;
      return (scoreItem(b, intent) + requestMatch(b)) - (scoreItem(a, intent) + requestMatch(a));
    });
  if (!replacements[0]) return current;
  const itemIds = { ...current.itemIds, [target]: replacements[0].id };
  return OutfitSchema.parse({
    ...current,
    id: uniqueId(Object.values(itemIds).filter((id): id is string => Boolean(id))),
    itemIds,
    deterministicScore: current.deterministicScore + 0.1,
    reason: "Better. Everything else stayed the same.",
  });
}

export function reviseOverall(current: Outfit, wardrobe: WardrobeItem[], intent: DailyIntent, request: string): Outfit {
  const normalized = request.toLowerCase();
  const lessFormal = /(less|too)\s+(mature|formal|polished)/.test(normalized);
  const moreFormal = /(more|slightly)\s+(polished|formal|elevated)/.test(normalized);
  const desiredFormality = Math.max(1, Math.min(5, (intent.desiredFormality ?? 3) + (lessFormal ? -1 : moreFormal ? 1 : 0)));
  const aestheticTerms = [...new Set([...intent.aestheticTerms, ...(/mature|formal/.test(normalized) ? ["relaxed", "cool"] : [])])];
  const candidates = generateCandidates(wardrobe, { ...intent, desiredFormality, aestheticTerms }, 16);
  const coreSlots: (keyof OutfitItemIds)[] = ["top", "bottom", "onePiece", "outerwear", "shoes"];
  const currentCore = coreSlots.filter((slot) => current.itemIds[slot]);
  const legal = candidates
    .filter((candidate) => candidate.id !== current.id)
    .map((candidate) => {
      const changedCore = coreSlots.filter((slot) => current.itemIds[slot] !== candidate.itemIds[slot]).length;
      const preservedCore = currentCore.filter((slot) => current.itemIds[slot] === candidate.itemIds[slot]).length;
      return { candidate, changedCore, preservedCore };
    })
    .filter(({ changedCore, preservedCore }) => changedCore <= 2 && preservedCore >= Math.ceil(currentCore.length / 2))
    .sort((a, b) => b.candidate.deterministicScore - a.candidate.deterministicScore);
  const next = legal[0]?.candidate;
  if (!next) return current;
  return OutfitSchema.parse({ ...next, reason: "This feels fresher while keeping the outfit recognizable." });
}

export function changedAndPreserved(before: Outfit, after: Outfit) {
  const beforeIds = Object.values(before.itemIds).filter((id): id is string => Boolean(id));
  const afterIds = Object.values(after.itemIds).filter((id): id is string => Boolean(id));
  return {
    changedItemIds: [...beforeIds.filter((id) => !afterIds.includes(id)), ...afterIds.filter((id) => !beforeIds.includes(id))],
    preservedItemIds: beforeIds.filter((id) => afterIds.includes(id)),
  };
}

export function validateRankedIds(candidateIds: string[], rankedIds: string[]) {
  return rankedIds.length === 3 && new Set(rankedIds).size === 3 && rankedIds.every((id) => candidateIds.includes(id));
}
