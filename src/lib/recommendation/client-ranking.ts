import { z } from "zod";
import { DailyIntentSchema, OutfitRankingResultSchema, WeatherContextSchema, type DailyIntent, type Outfit, type WardrobeItem, type WeatherContext } from "@/domain/schemas";
import { applyVisualRanking, validateSelectedId } from "@/domain/recommendation/engine";
import { renderCandidateBoard } from "@/lib/recommendation/board-renderer";

const RankResponseSchema = z.object({
  requestId: z.string().uuid(),
  ranking: OutfitRankingResultSchema,
  source: z.enum(["mock", "live", "fallback"]),
  model: z.string().min(1).max(80).nullable(),
  diagnostics: z.object({ requestId: z.string().uuid(), boardBytes: z.number().int().nonnegative(), candidateCount: z.number().int().positive(), errorCode: z.string().optional() }).strict(),
}).strict();

export type RankedOutfits = {
  outfit: Outfit;
  mainReason: string;
  source: "mock" | "live" | "fallback";
  model: string | null;
  diagnosticCode?: string;
};

function fallback(candidates: Outfit[], diagnosticCode?: string): RankedOutfits {
  const outfit = [...candidates].sort((a, b) => b.deterministicScore - a.deterministicScore)[0];
  if (!outfit) throw new Error("No legal outfit candidates");
  return {
    outfit,
    mainReason: outfit.reason ?? "A legal, cohesive answer for today.",
    source: "fallback",
    model: null,
    diagnosticCode,
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
  recommendationOperationId?: string;
  profileVersion?: number;
  outfitVersion?: string | null;
}): Promise<RankedOutfits> {
  const candidates = input.candidates.slice(0, 8);
  if (candidates.length < 1) throw new Error("No legal outfit candidates");
  try {
    DailyIntentSchema.parse(input.intent);
    if (input.weather) WeatherContextSchema.parse(input.weather);
    const rendered = await Promise.all(candidates.map((candidate) => renderCandidateBoard(candidate, input.wardrobe)));
    const totalBoardBytes = rendered.reduce((sum, board) => sum + board.bytes, 0);
    if (rendered.some((board) => board.bytes > 240_000 || board.dataUrl.length > 340_000) || totalBoardBytes > 1_900_000) return fallback(candidates, "BOARD_TOO_LARGE");
    const boards = candidates.map((candidate, index) => ({
      id: candidate.id,
      itemIds: Object.values(candidate.itemIds).filter((id): id is string => Boolean(id)),
      deterministicScore: candidate.deterministicScore,
      boardDataUrl: rendered[index].dataUrl,
      boardBytes: rendered[index].bytes,
      boardWidth: rendered[index].width,
      boardHeight: rendered[index].height,
    }));
    const originalUtterance = input.originalUtterance.trim() || input.intent.freeformSummary.trim() || "Structured daily outfit request.";
    const response = await fetch("/api/outfits/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: input.signal,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        originalUtterance,
        intent: input.intent,
        preferences: { summary: input.preferenceSummary },
        weather: input.weather,
        candidates: boards,
        correlation: input.recommendationOperationId ? {
          recommendationOperationId: input.recommendationOperationId,
          profileVersion: input.profileVersion ?? 0,
          outfitVersion: input.outfitVersion ?? null,
        } : undefined,
      }),
    });
    if (!response.ok) return fallback(candidates, `RANK_HTTP_${response.status}`);
    const payload = RankResponseSchema.parse(await response.json());
    const candidateIds = candidates.map((candidate) => candidate.id);
    if (!validateSelectedId(candidateIds, payload.ranking.selectedCandidateId)) return fallback(candidates, "INVALID_RANK_IDS");
    const lookup = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const scoreIds = payload.ranking.candidateScores.map((entry) => entry.candidateId);
    if (payload.source === "live" && (scoreIds.length !== candidateIds.length || new Set(scoreIds).size !== scoreIds.length || scoreIds.some((id) => !lookup.has(id)))) return fallback(candidates, "INVALID_RANK_IDS");
    const visuallyScored = payload.ranking.candidateScores.flatMap((visual) => {
      const candidate = lookup.get(visual.candidateId);
      if (!candidate) return [];
      const visualScore = (visual.visualCoherence + visual.colorBalance + visual.silhouetteBalance + visual.materialHarmony + visual.styleClarity) / 5;
      return [applyVisualRanking({ candidate, visualScore, reason: visual.reason, concerns: visual.concerns })];
    });
    const outfit = visuallyScored.sort((a, b) => b.deterministicScore - a.deterministicScore)[0]
      ?? applyVisualRanking({ candidate: lookup.get(payload.ranking.selectedCandidateId)!, visualScore: undefined, reason: payload.ranking.mainReason });
    return {
      outfit,
      mainReason: outfit.reason ?? payload.ranking.mainReason,
      source: payload.source,
      model: payload.model,
    };
  } catch (error) {
    return fallback(candidates, error instanceof Error && error.message === "BOARD_TOO_LARGE" ? "BOARD_TOO_LARGE" : "RANK_CLIENT_FAILED");
  }
}
