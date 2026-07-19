import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { DailyIntentSchema, OutfitRankingResultSchema, WeatherContextSchema } from "@/domain/schemas";
import { validateRankingReferences } from "@/domain/recommendation/engine";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { providerRoutesAllowed, takeRateLimit } from "@/lib/api/rate-limit";
import { logApiDiagnostic, responseRequestId, responseUsage, safeErrorMetadata } from "@/lib/api/diagnostics";

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
    boardDataUrl: z.string().max(340_000).refine((value) => value.startsWith("data:image/webp;base64,") || value.startsWith("data:image/png;base64,")),
    boardBytes: z.number().int().positive().max(240_000),
    boardWidth: z.number().int().min(256).max(1024),
    boardHeight: z.number().int().min(256).max(1280),
  }).strict()).min(1).max(8),
}).strict();

function boardMime(dataUrl: string): "image/webp" | "image/png" {
  return dataUrl.startsWith("data:image/png;base64,") ? "image/png" : "image/webp";
}

function requestImageMime(candidates: z.infer<typeof RankRequestSchema>["candidates"]): "image/webp" | "image/png" | "mixed" {
  const mimes = new Set(candidates.map((candidate) => boardMime(candidate.boardDataUrl)));
  return mimes.size === 1 ? boardMime(candidates[0].boardDataUrl) : "mixed";
}

const compatibilityStages = ["text", "single-image", "image-plain-text", "minimal-schema", "full-schema-single"] as const;
const MinimalCompatibilitySchema = z.object({ ok: z.boolean() }).strict();

async function runCompatibilityStage(input: z.infer<typeof RankRequestSchema>, stage: (typeof compatibilityStages)[number], requestId: string, openai: OpenAI, model: string) {
  const startedAt = Date.now();
  const first = input.candidates[0];
  const imageMime = boardMime(first.boardDataUrl);
  const baseImage: OpenAI.Responses.ResponseInputImage = { type: "input_image", image_url: first.boardDataUrl, detail: "high" };
  const common = { model, store: false, reasoning: { effort: "none" as const }, max_output_tokens: 600 };
  let response: OpenAI.Responses.Response;
  if (stage === "text") {
    response = await openai.responses.create({ ...common, input: "Reply with exactly: compatible" }, { signal: AbortSignal.timeout(20_000) });
  } else if (stage === "single-image" || stage === "image-plain-text") {
    response = await openai.responses.create({ ...common, input: [{ role: "user", content: [{ type: "input_text", text: stage === "single-image" ? "Reply readable or unreadable." : "Describe this outfit board in no more than eight words." }, baseImage] }] }, { signal: AbortSignal.timeout(20_000) });
  } else if (stage === "minimal-schema") {
    response = await openai.responses.parse({ ...common, input: [{ role: "user", content: [{ type: "input_text", text: "Return ok true if this outfit board is readable." }, baseImage] }], text: { format: zodTextFormat(MinimalCompatibilitySchema, "compatibility_check") } }, { signal: AbortSignal.timeout(20_000) });
  } else {
    response = await openai.responses.parse({ ...common, input: [{ role: "user", content: [{ type: "input_text", text: `Evaluate the one supplied candidate. Return this exact candidate ID and one score object for it: ${first.id}` }, baseImage] }], text: { format: zodTextFormat(OutfitRankingResultSchema, "outfit_ranking") } }, { signal: AbortSignal.timeout(20_000) });
  }
  const durationMs = Date.now() - startedAt;
  const actualModel = response.model || model;
  logApiDiagnostic({ requestId, route: "/api/outfits/rank", provider: "openai-responses", model: actualModel, outcome: "success", httpStatus: 200, providerRequestId: responseRequestId(response), durationMs, usage: responseUsage(response), candidateCount: 1, boardBytes: first.boardBytes, boardWidth: first.boardWidth, boardHeight: first.boardHeight, imageMime, providerStage: stage, schemaName: stage === "minimal-schema" ? "compatibility_check" : stage === "full-schema-single" ? "outfit_ranking" : undefined });
  return noStoreJson({ requestId, stage, outcome: "success", model: actualModel, durationMs, usage: responseUsage(response), image: stage === "text" ? null : { mime: imageMime, bytes: first.boardBytes, width: first.boardWidth, height: first.boardHeight }, schemaName: stage === "minimal-schema" ? "compatibility_check" : stage === "full-schema-single" ? "outfit_ranking" : null });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const requestedStage = new URL(request.url).searchParams.get("compatibilityStage");
  const compatibilityStage = compatibilityStages.find((stage) => stage === requestedStage);
  if (requestedStage && (!compatibilityStage || process.env.YIYI_RANK_COMPATIBILITY !== "true" || process.env.VERCEL_ENV === "production")) return apiError(requestId, 404, "NOT_FOUND", "Not found.");
  if (!providerRoutesAllowed()) return apiError(requestId, 503, "PUBLIC_PROTECTION_REQUIRED", "Live ranking is not available until production rate protection is configured.", true);
  const rate = await takeRateLimit(request, "outfit-rank", 40);
  if (!rate.allowed) return apiError(requestId, 429, "RATE_LIMITED", `Try again in ${rate.retryAfterSeconds} seconds.`, true);
  try {
    const parsed = RankRequestSchema.safeParse(await request.json());
    if (!parsed.success) return apiError(requestId, 400, "INVALID_RANK_REQUEST", "The outfit candidates were invalid.");
    const input = parsed.data;
    const boardBytes = input.candidates.reduce((sum, candidate) => sum + candidate.boardBytes, 0);
    const boardWidth = Math.max(...input.candidates.map((candidate) => candidate.boardWidth));
    const boardHeight = Math.max(...input.candidates.map((candidate) => candidate.boardHeight));
    const imageMime = requestImageMime(input.candidates);
    const deterministic = [...input.candidates].sort((a, b) => b.deterministicScore - a.deterministicScore)[0];
    if (process.env.AI_MODE !== "live") return noStoreJson({ requestId, ranking: { selectedCandidateId: deterministic.id, mainReason: "A legal, cohesive answer for today.", candidateScores: [] }, source: "mock", model: null, diagnostics: { requestId, boardBytes, candidateCount: input.candidates.length } });
    if (!process.env.OPENAI_API_KEY) return apiError(requestId, 503, "NOT_CONFIGURED", "Live ranking is not configured.", true);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_RANK_MODEL ?? "gpt-5.6";
    if (compatibilityStage) {
      const compatibilityStartedAt = Date.now();
      try { return await runCompatibilityStage(input, compatibilityStage, requestId, openai, model); }
      catch (error) {
        const metadata = safeErrorMetadata(error);
        logApiDiagnostic({ requestId, route: "/api/outfits/rank", provider: "openai-responses", model, outcome: "error", ...metadata, durationMs: Date.now() - compatibilityStartedAt, errorCode: "RANK_COMPATIBILITY_FAILED", candidateCount: 1, boardBytes: input.candidates[0].boardBytes, boardWidth: input.candidates[0].boardWidth, boardHeight: input.candidates[0].boardHeight, imageMime: boardMime(input.candidates[0].boardDataUrl), providerStage: compatibilityStage, schemaName: compatibilityStage === "minimal-schema" ? "compatibility_check" : compatibilityStage === "full-schema-single" ? "outfit_ranking" : undefined });
        return apiError(requestId, 502, "RANK_COMPATIBILITY_FAILED", "Compatibility stage failed.", true);
      }
    }
    const content: OpenAI.Responses.ResponseInputContent[] = [
      { type: "input_text", text: `Evaluate every supplied legal candidate as a complete outfit, then choose exactly one supplied ID. Never invent, alter, or combine candidates. Score visualCoherence, colorBalance, silhouetteBalance, materialHarmony, and styleClarity from 0 to 1 for each candidate. For every candidate, return a concise candidate-specific reason under 18 words plus concrete visual concerns. mainReason must describe selectedCandidateId.\nUser: ${input.originalUtterance}\nIntent: ${JSON.stringify(input.intent)}\nPreferences: ${input.preferences.summary}\nWeather: ${JSON.stringify(input.weather)}\nCandidates: ${JSON.stringify(input.candidates.map(({ id, itemIds, deterministicScore }) => ({ id, itemIds, deterministicScore })))}` },
      ...input.candidates.map((candidate): OpenAI.Responses.ResponseInputImage => ({ type: "input_image", image_url: candidate.boardDataUrl, detail: "high" })),
    ];
    const providerStartedAt = Date.now();
    const response = await openai.responses.parse({
        model,
        store: false,
        reasoning: { effort: "none" },
        input: [{ role: "user", content }],
        text: { format: zodTextFormat(OutfitRankingResultSchema, "outfit_ranking") },
      }, { signal: AbortSignal.timeout(20_000) }).catch((error: unknown) => {
      const metadata = safeErrorMetadata(error);
      logApiDiagnostic({ requestId, route: "/api/outfits/rank", provider: "openai-responses", model, outcome: "error", ...metadata, durationMs: Date.now() - providerStartedAt, errorCode: "RANK_PROVIDER_FAILED", candidateCount: input.candidates.length, boardBytes, boardWidth, boardHeight, imageMime, providerStage: "full-listwise-structured", schemaName: "outfit_ranking" });
      return null;
    });
    if (!response) return apiError(requestId, 502, "RANK_PROVIDER_FAILED", "I’ve put together a simpler option for now.", true);
    const actualModel = response.model || model;
    const parsedRanking = OutfitRankingResultSchema.safeParse(response.output_parsed);
    if (!parsedRanking.success) {
      logApiDiagnostic({ requestId, route: "/api/outfits/rank", provider: "openai-responses", model: actualModel, outcome: "error", httpStatus: 200, providerRequestId: responseRequestId(response), durationMs: Date.now() - providerStartedAt, errorCode: "INVALID_RANK_OUTPUT", errorType: "InvalidProviderOutput", usage: responseUsage(response), candidateCount: input.candidates.length, boardBytes, boardWidth, boardHeight, imageMime, providerStage: "full-listwise-structured", schemaName: "outfit_ranking" });
      return apiError(requestId, 502, "INVALID_RANK_OUTPUT", "I’ve put together a simpler option for now.", true);
    }
    const ranking = parsedRanking.data;
    const candidateIds = input.candidates.map((value) => value.id);
    if (!validateRankingReferences(candidateIds, ranking.selectedCandidateId, ranking.candidateScores.map((entry) => entry.candidateId))) {
      logApiDiagnostic({ requestId, route: "/api/outfits/rank", provider: "openai-responses", model: actualModel, outcome: "error", httpStatus: 200, providerRequestId: responseRequestId(response), durationMs: Date.now() - providerStartedAt, errorCode: "INVALID_RANK_IDS", errorType: "InvalidProviderOutput", usage: responseUsage(response), candidateCount: input.candidates.length, boardBytes, boardWidth, boardHeight, imageMime, providerStage: "full-listwise-structured", schemaName: "outfit_ranking" });
      return noStoreJson({ requestId, ranking: { selectedCandidateId: deterministic.id, mainReason: "A legal, cohesive answer for today.", candidateScores: [] }, source: "fallback", model: actualModel, diagnostics: { requestId, boardBytes, candidateCount: input.candidates.length, errorCode: "INVALID_RANK_IDS" } });
    }
    logApiDiagnostic({ requestId, route: "/api/outfits/rank", provider: "openai-responses", model: actualModel, outcome: "success", httpStatus: 200, providerRequestId: responseRequestId(response), durationMs: Date.now() - providerStartedAt, usage: responseUsage(response), candidateCount: input.candidates.length, boardBytes, boardWidth, boardHeight, imageMime, providerStage: "full-listwise-structured", schemaName: "outfit_ranking" });
    return noStoreJson({ requestId, ranking, source: "live", model: actualModel, diagnostics: { requestId, boardBytes, candidateCount: input.candidates.length } });
  } catch {
    return apiError(requestId, 500, "RANK_FAILED", "I’ve put together a simpler option for now.", true);
  }
}
