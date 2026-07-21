import { OutfitItemIdsSchema, type Outfit, type OutfitSlot } from "@/domain/schemas";
import { RecommendationError, type RecommendationContext } from "@/domain/recommendation/context";
import { slotCategories, validateOutfit, validatePartial, validateRequiredAnchors } from "@/domain/recommendation/constraints";
import { outfitSimilarity, scoreCandidate, scoreItemHeuristic, scorePartialCompatibility } from "@/domain/recommendation/scoring";
import { situationItemViolation } from "@/domain/recommendation/situation";

type TemplateName = "separates" | "one_piece";
type PartialCandidate = { template: TemplateName; itemIds: Partial<Record<OutfitSlot, string>>; partialScore: number };

export type SearchDiagnostics = {
  beamWidth: number;
  expandedPartialCount: number;
  finalLegalCount: number;
  rejectionCounts: Record<string, number>;
};

export type CandidateSearchResult = { candidates: Outfit[]; diagnostics: SearchDiagnostics };

const optionalSlots = new Set<OutfitSlot>(["outerwear", "bag", "jewelry", "extraAccessory"]);

function templatesFor(context: RecommendationContext, requiredSlots: Map<OutfitSlot, string>) {
  if (requiredSlots.has("onePiece")) return ["one_piece"] as TemplateName[];
  if (requiredSlots.has("top") || requiredSlots.has("bottom")) return ["separates"] as TemplateName[];
  if (context.targetSlots.has("onePiece")) return ["one_piece"] as TemplateName[];
  if (context.targetSlots.has("top") || context.targetSlots.has("bottom")) return ["separates"] as TemplateName[];
  return ["separates", "one_piece"] as TemplateName[];
}

function stagesFor(template: TemplateName, context: RecommendationContext, requiredSlots: Map<OutfitSlot, string>) {
  const core: OutfitSlot[] = template === "separates" ? ["top", "bottom", "shoes"] : ["onePiece", "shoes"];
  const weatherFirst = context.weather?.expectedRain || (context.weather && context.weather.minApparentTempC < 10);
  const ordered = weatherFirst ? [...core, "outerwear", "bag", "jewelry", "extraAccessory"] as OutfitSlot[] : [...core, "bag", "outerwear", "jewelry", "extraAccessory"] as OutfitSlot[];
  return ordered.map((slot, index) => ({ slot, index, priority: requiredSlots.has(slot) ? 0 : context.preserveSlots.has(slot) ? 1 : 2 }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((entry) => entry.slot);
}

function choicesForSlot(slot: OutfitSlot, context: RecommendationContext, requiredSlots: Map<OutfitSlot, string>) {
  const required = requiredSlots.get(slot);
  if (required) return [required];
  if (context.requiredEmptySlots.has(slot) || context.situation.slotPolicy[slot] === "forbidden") return [undefined];
  if (context.preserveSlots.has(slot) && context.currentOutfit) return [context.currentOutfit.itemIds[slot]];
  const currentId = context.currentOutfit?.itemIds[slot];
  const choices = context.wardrobe
    .filter((item) => slotCategories[slot].includes(item.category))
    .filter((item) => !situationItemViolation(item, slot, context.situation))
    .filter((item) => !(context.operation === "targeted_revision" && context.targetSlots.has(slot) && item.id === currentId))
    .sort((a, b) => scoreItemHeuristic(b, context) - scoreItemHeuristic(a, context))
    .map((item) => item.id as string | undefined);
  if (optionalSlots.has(slot) && !required && !(context.operation === "targeted_revision" && context.targetSlots.has(slot))) choices.push(undefined);
  return choices;
}

function partialSignature(candidate: PartialCandidate) {
  return Object.entries(candidate.itemIds).sort(([a], [b]) => a.localeCompare(b)).map(([slot, id]) => `${slot}:${id ?? "-"}`).join("|");
}

function beamGroup(candidate: PartialCandidate, context: RecommendationContext) {
  const resolved = Object.values(candidate.itemIds).map((id) => context.wardrobeIndex.get(id)).filter(Boolean);
  const coreItems = resolved.filter((item) => item && ["top", "bottom", "one_piece"].includes(item.category));
  const items = coreItems.length ? coreItems : resolved;
  const colors = [...new Set(items.map((item) => item!.primaryColor))].sort().slice(0, 2).join("+");
  const styles = [...new Set(items.flatMap((item) => item!.styleTags))].sort().slice(0, 2).join("+");
  const optionalPresence = (["outerwear", "bag", "jewelry", "extraAccessory"] as OutfitSlot[]).filter((slot) => candidate.itemIds[slot]).join("+") || "core-only";
  return `${candidate.template}:${colors}:${styles}:${optionalPresence}`;
}

function selectBeam(candidates: PartialCandidate[], width: number, context: RecommendationContext) {
  const unique = new Map<string, PartialCandidate>();
  for (const candidate of candidates.sort((a, b) => b.partialScore - a.partialScore)) {
    const signature = partialSignature(candidate);
    if (!unique.has(signature)) unique.set(signature, candidate);
    if (unique.size >= width * 2) break;
  }
  const selected: PartialCandidate[] = [];
  const representedGroups = new Set<string>();
  for (const candidate of unique.values()) {
    const group = beamGroup(candidate, context);
    if (representedGroups.has(group)) continue;
    representedGroups.add(group);
    selected.push(candidate);
    if (selected.length >= Math.min(width, 12)) break;
  }
  for (const candidate of unique.values()) {
    if (selected.includes(candidate)) continue;
    const ids = new Set(Object.values(candidate.itemIds).filter(Boolean));
    const nearDuplicate = selected.some((entry) => {
      const other = Object.values(entry.itemIds).filter(Boolean);
      return other.length >= 3 && other.filter((id) => ids.has(id)).length === other.length;
    });
    if (!nearDuplicate || selected.length < Math.min(8, width)) selected.push(candidate);
    if (selected.length === width) break;
  }
  return selected;
}

export function generateLegalCandidates(context: RecommendationContext): CandidateSearchResult {
  const requiredSlots = validateRequiredAnchors(context);
  const beamWidth = Math.min(48, Math.max(18, context.wardrobe.length * 2));
  const rejectionCounts: Record<string, number> = {};
  let expandedPartialCount = 0;
  const finished: PartialCandidate[] = [];

  for (const template of templatesFor(context, requiredSlots)) {
    const stages = stagesFor(template, context, requiredSlots);
    let beam: PartialCandidate[] = [{ template, itemIds: {}, partialScore: 0 }];
    for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
      const slot = stages[stageIndex];
      const remaining = new Set(stages.slice(stageIndex + 1));
      const expanded: PartialCandidate[] = [];
      for (const partial of beam) {
        for (const id of choicesForSlot(slot, context, requiredSlots)) {
          expandedPartialCount += 1;
          const itemIds = { ...partial.itemIds };
          if (id) itemIds[slot] = id;
          else delete itemIds[slot];
          const validation = validatePartial(itemIds, context, remaining);
          if (!validation.valid) {
            for (const violation of validation.violations) rejectionCounts[violation.code] = (rejectionCounts[violation.code] ?? 0) + 1;
            continue;
          }
          const item = id ? context.wardrobeIndex.get(id) : undefined;
          const compatibility = item ? scorePartialCompatibility(Object.values(partial.itemIds).filter((value): value is string => Boolean(value)), item, context) : 0.7;
          expanded.push({ template, itemIds, partialScore: partial.partialScore + (item ? scoreItemHeuristic(item, context) * 0.72 + compatibility * 0.28 : optionalSlots.has(slot) ? 0.56 : 0.04) });
        }
      }
      beam = selectBeam(expanded, beamWidth, context);
      if (!beam.length) break;
    }
    finished.push(...beam);
  }

  const candidates: Outfit[] = [];
  for (const partial of finished) {
    const parsed = OutfitItemIdsSchema.safeParse(partial.itemIds);
    if (!parsed.success) { rejectionCounts.INVALID_STRUCTURE = (rejectionCounts.INVALID_STRUCTURE ?? 0) + 1; continue; }
    const validation = validateOutfit(parsed.data, context);
    if (!validation.valid) {
      for (const violation of validation.violations) rejectionCounts[violation.code] = (rejectionCounts[violation.code] ?? 0) + 1;
      continue;
    }
    candidates.push(scoreCandidate(parsed.data, context));
  }

  const sorted = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()]
    .sort((a, b) => b.deterministicScore - a.deterministicScore);
  const unique: Outfit[] = [];
  const represented = new Set<string>();
  for (const candidate of sorted) {
    const group = beamGroup({ template: candidate.itemIds.onePiece ? "one_piece" : "separates", itemIds: candidate.itemIds, partialScore: candidate.deterministicScore }, context);
    if (represented.has(group)) continue;
    represented.add(group);
    unique.push(candidate);
    if (unique.length === Math.min(16, sorted.length)) break;
  }
  for (const candidate of sorted) {
    if (!unique.includes(candidate)) unique.push(candidate);
    if (unique.length === 64) break;
  }
  if (!unique.length) {
    const code = context.operation === "targeted_revision" ? "TARGET_REPLACEMENT_UNAVAILABLE" : "NO_LEGAL_OUTFIT";
    throw new RecommendationError(code, context.operation === "targeted_revision" ? "No legal replacement preserves the rest of this outfit." : "No legal outfit satisfies every current requirement.", Object.keys(rejectionCounts));
  }
  return { candidates: unique, diagnostics: { beamWidth, expandedPartialCount, finalLegalCount: unique.length, rejectionCounts } };
}

export function selectDiverseCandidates(candidates: Outfit[], context: RecommendationContext, limit = 8) {
  const selected: Outfit[] = [];
  const pool = [...candidates];
  while (pool.length && selected.length < limit) {
    const next = pool.sort((a, b) => {
      const aSimilarity = selected.length ? Math.max(...selected.map((item) => outfitSimilarity(a, item, context))) : 0;
      const bSimilarity = selected.length ? Math.max(...selected.map((item) => outfitSimilarity(b, item, context))) : 0;
      return (b.deterministicScore - bSimilarity * 18) - (a.deterministicScore - aSimilarity * 18);
    }).shift();
    if (next) selected.push(next);
  }
  return selected;
}

function seededJitter(seed: number, id: string) {
  let value = seed;
  for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return ((value >>> 0) % 10_000) / 10_000;
}

export function selectDeterministicAnswer(candidates: Outfit[], context: RecommendationContext) {
  let pool = candidates.filter((candidate) => candidate.id !== context.currentOutfit?.id);
  if (context.operation === "random_new_outfit") {
    const unseen = pool.filter((candidate) => !context.shownOutfitIds.has(candidate.id));
    if (unseen.length) pool = unseen;
    const best = pool[0]?.deterministicScore ?? 0;
    const qualityBand = pool.filter((candidate) => candidate.deterministicScore >= best - 12);
    return [...qualityBand].sort((a, b) => {
      const aSimilarity = context.currentOutfit ? outfitSimilarity(a, context.currentOutfit, context) : 0;
      const bSimilarity = context.currentOutfit ? outfitSimilarity(b, context.currentOutfit, context) : 0;
      const aScore = a.deterministicScore - aSimilarity * 24 + seededJitter(context.seed, a.id) * 3;
      const bScore = b.deterministicScore - bSimilarity * 24 + seededJitter(context.seed, b.id) * 3;
      return bScore - aScore;
    })[0] ?? null;
  }
  return pool[0] ?? candidates[0] ?? null;
}
