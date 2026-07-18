import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { DailyIntentSchema, OutfitRankingResultSchema, WeatherContextSchema } from "@/domain/schemas";
import { validateRankedIds } from "@/domain/recommendation/engine";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { takeRateLimit } from "@/lib/api/rate-limit";
import { logApiDiagnostic, responseUsage, safeErrorMetadata } from "@/lib/api/diagnostics";

export const runtime = "nodejs";
export const maxDuration = 30;

const RankRequestSchema = z.object({
  requestId: z.string().uuid(),
  originalUtterance: z.string().min(1).max(500),
  intent: DailyIntentSchema,
  preferences: z.object({ summary: z.string().max(500) }).strict(),
  weather: WeatherContextSchema.nullable(),
  candidates: z.array(z.object({
    id: z.string().uuid(),
    itemIds: z.array(z.string().uuid()).min(3).max(8),
    deterministicScore: z.number(),
    boardDataUrl: z.string().startsWith("data:image/webp;base64,").max(180_000),
  }).strict()).min(3).max(8),
}).strict();

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rate = takeRateLimit(request, "outfit-rank", 40);
  if (!rate.allowed) return apiError(requestId, 429, "RATE_LIMITED", `Try again in ${rate.retryAfterSeconds} seconds.`, true);
  try {
    const parsed = RankRequestSchema.safeParse(await request.json());
    if (!parsed.success) return apiError(requestId, 400, "INVALID_RANK_REQUEST", "The outfit candidates were invalid.");
    const input = parsed.data;
    const deterministic = [...input.candidates].sort((a, b) => b.deterministicScore - a.deterministicScore).slice(0, 3);
    if (process.env.AI_MODE !== "live") return noStoreJson({ requestId, ranking: { rankedCandidateIds: deterministic.map((value) => value.id), mainReason: "Cool and effortless, with enough comfort for the full day.", alternativeReasons: ["A softer, more relaxed direction.", "A slightly more polished option."] }, source: "mock" });
    if (!process.env.OPENAI_API_KEY) return apiError(requestId, 503, "NOT_CONFIGURED", "Live ranking is not configured.", true);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_RANK_MODEL ?? "gpt-5.6";
    const content: OpenAI.Responses.ResponseInputContent[] = [
      { type: "input_text", text: `Choose exactly three candidate IDs from the supplied set. Never invent or change items. Select one decisive main look and two meaningfully different alternatives. Keep every reason under 18 words.\nUser: ${input.originalUtterance}\nIntent: ${JSON.stringify(input.intent)}\nPreferences: ${input.preferences.summary}\nWeather: ${JSON.stringify(input.weather)}\nCandidates: ${JSON.stringify(input.candidates.map(({ id, itemIds, deterministicScore }) => ({ id, itemIds, deterministicScore })))}` },
      ...input.candidates.map((candidate): OpenAI.Responses.ResponseInputImage => ({ type: "input_image", image_url: candidate.boardDataUrl, detail: "high" })),
    ];
    const providerStartedAt = Date.now();
    const response = await openai.responses.parse({
        model,
        store: false,
        reasoning: { effort: "low" },
        input: [{ role: "user", content }],
        text: { format: zodTextFormat(OutfitRankingResultSchema, "outfit_ranking") },
      }, { signal: AbortSignal.timeout(20_000) }).catch((error: unknown) => {
      const metadata = safeErrorMetadata(error);
      logApiDiagnostic({ requestId, route: "/api/outfits/rank", provider: "openai-responses", model, outcome: "error", ...metadata, durationMs: Date.now() - providerStartedAt, errorCode: "RANK_PROVIDER_FAILED" });
      return null;
    });
    if (!response) return apiError(requestId, 502, "RANK_PROVIDER_FAILED", "I’ve put together a simpler option for now.", true);
    const parsedRanking = OutfitRankingResultSchema.safeParse(response.output_parsed);
    if (!parsedRanking.success) {
      logApiDiagnostic({ requestId, route: "/api/outfits/rank", provider: "openai-responses", model, outcome: "error", httpStatus: 200, durationMs: Date.now() - providerStartedAt, errorCode: "INVALID_RANK_OUTPUT", errorType: "InvalidProviderOutput", usage: responseUsage(response) });
      return apiError(requestId, 502, "INVALID_RANK_OUTPUT", "I’ve put together a simpler option for now.", true);
    }
    const ranking = parsedRanking.data;
    if (!validateRankedIds(input.candidates.map((value) => value.id), ranking.rankedCandidateIds)) {
      logApiDiagnostic({ requestId, route: "/api/outfits/rank", provider: "openai-responses", model, outcome: "error", httpStatus: 200, durationMs: Date.now() - providerStartedAt, errorCode: "INVALID_RANK_IDS", errorType: "InvalidProviderOutput", usage: responseUsage(response) });
      return noStoreJson({ requestId, ranking: { rankedCandidateIds: deterministic.map((value) => value.id), mainReason: "A balanced choice for today.", alternativeReasons: ["A softer option.", "A more polished option."] }, source: "fallback" });
    }
    logApiDiagnostic({ requestId, route: "/api/outfits/rank", provider: "openai-responses", model, outcome: "success", httpStatus: 200, durationMs: Date.now() - providerStartedAt, usage: responseUsage(response) });
    return noStoreJson({ requestId, ranking, source: "gpt-5.6" });
  } catch {
    return apiError(requestId, 500, "RANK_FAILED", "I’ve put together a simpler option for now.", true);
  }
}
