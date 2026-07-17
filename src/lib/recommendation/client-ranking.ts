import { z } from "zod";
import { DailyIntentSchema, OutfitRankingResultSchema, WeatherContextSchema, type DailyIntent, type Outfit, type WardrobeItem, type WeatherContext } from "@/domain/schemas";
import { validateRankedIds } from "@/domain/recommendation/engine";
import { renderCandidateBoard } from "@/lib/recommendation/board-renderer";

const RankResponseSchema = z.object({
  requestId: z.string().uuid(),
  ranking: OutfitRankingResultSchema,
  source: z.enum(["mock", "gpt-5.6", "fallback"]).optional(),
}).strict();

export type RankedOutfits = {
  outfits: Outfit[];
  mainReason: string;
  alternativeReasons: [string, string];
  source: "mock" | "gpt-5.6" | "fallback";
};

function fallback(candidates: Outfit[]): RankedOutfits {
  return {
    outfits: [...candidates].sort((a, b) => b.deterministicScore - a.deterministicScore).slice(0, 3),
    mainReason: "Cool and effortless, with enough comfort for the full day.",
    alternativeReasons: ["A softer, more relaxed direction.", "A slightly more polished option."],
    source: "fallback",
  };
}

export async function rankOutfits(input: {
  candidates: Outfit[];
  wardrobe: WardrobeItem[];
  intent: DailyIntent;
  originalUtterance: string;
  preferenceSummary: string;
  weather: WeatherContext | null;
  signal?: AbortSignal;
}): Promise<RankedOutfits> {
  const candidates = input.candidates.slice(0, 8);
  if (candidates.length < 3) return fallback(candidates);
  try {
    DailyIntentSchema.parse(input.intent);
    if (input.weather) WeatherContextSchema.parse(input.weather);
    const boards = await Promise.all(candidates.map(async (candidate) => ({
      id: candidate.id,
      itemIds: Object.values(candidate.itemIds).filter((id): id is string => Boolean(id)),
      deterministicScore: candidate.deterministicScore,
      boardDataUrl: await renderCandidateBoard(candidate, input.wardrobe),
    })));
    const response = await fetch("/api/outfits/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: input.signal,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        originalUtterance: input.originalUtterance,
        intent: input.intent,
        preferences: { summary: input.preferenceSummary },
        weather: input.weather,
        candidates: boards,
      }),
    });
    if (!response.ok) return fallback(candidates);
    const payload = RankResponseSchema.parse(await response.json());
    if (!validateRankedIds(candidates.map((candidate) => candidate.id), payload.ranking.rankedCandidateIds)) return fallback(candidates);
    const lookup = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    return {
      outfits: payload.ranking.rankedCandidateIds.map((id) => lookup.get(id)!),
      mainReason: payload.ranking.mainReason,
      alternativeReasons: [payload.ranking.alternativeReasons[0], payload.ranking.alternativeReasons[1]],
      source: payload.source ?? "gpt-5.6",
    };
  } catch {
    return fallback(candidates);
  }
}
