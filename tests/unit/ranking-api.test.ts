import { afterEach, describe, expect, it, vi } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { OutfitRankingResultSchema } from "@/domain/schemas";

const renderMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/recommendation/board-renderer", () => ({ renderCandidateBoard: renderMock }));

import { POST as rankRoute } from "@/app/api/outfits/rank/route";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { runRecommendationDecision } from "@/domain/recommendation/engine";
import { rankOutfits } from "@/lib/recommendation/client-ranking";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";

const candidateId = "11111111-1111-4111-8111-111111111111";
const routeBody = {
  requestId: "99999999-9999-4999-8999-999999999999",
  originalUtterance: "Gallery and dinner",
  intent: demoIntent,
  preferences: { summary: "Neutral" },
  weather: null,
  candidates: [{
    id: candidateId,
    itemIds: [
      "22222222-2222-4222-8222-222222222221",
      "33333333-3333-4333-8333-333333333331",
      "44444444-4444-4444-8444-444444444441",
    ],
    deterministicScore: 80,
    boardDataUrl: "data:image/webp;base64,AA==",
    boardBytes: 2,
    boardWidth: 512,
    boardHeight: 640,
  }],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  renderMock.mockReset();
});

describe("ranking boundary semantics", () => {
  it("keeps every structured-output field required for the live provider", () => {
    const format = zodTextFormat(OutfitRankingResultSchema, "outfit_ranking");
    expect((format.schema as { required?: string[] }).required).toContain("candidateScores");
  });

  it("keeps staged provider probes disabled unless explicitly enabled outside production", async () => {
    vi.stubEnv("YIYI_RANK_COMPATIBILITY", "false");
    const response = await rankRoute(new Request("http://localhost/api/outfits/rank?compatibilityStage=text", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(routeBody) }));
    expect(response.status).toBe(404);
  });

  it("reports an actual mock source/model and rejects empty utterances or oversized boards", async () => {
    vi.stubEnv("AI_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "mock");
    const valid = await rankRoute(new Request("http://localhost/api/outfits/rank", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(routeBody) }));
    const payload = await valid.json();
    expect(valid.status).toBe(200);
    expect(payload).toMatchObject({ source: "mock", model: null, diagnostics: { boardBytes: 2, candidateCount: 1 } });

    const png = await rankRoute(new Request("http://localhost/api/outfits/rank", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() }, body: JSON.stringify({ ...routeBody, candidates: [{ ...routeBody.candidates[0], boardDataUrl: "data:image/png;base64,AA==" }] }) }));
    expect(png.status).toBe(200);

    const empty = await rankRoute(new Request("http://localhost/api/outfits/rank", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() }, body: JSON.stringify({ ...routeBody, originalUtterance: "" }) }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe("INVALID_RANK_REQUEST");

    const oversized = await rankRoute(new Request("http://localhost/api/outfits/rank", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() }, body: JSON.stringify({ ...routeBody, candidates: [{ ...routeBody.candidates[0], boardBytes: 240_001 }] }) }));
    expect(oversized.status).toBe(400);
  });

  it("fails closed in live production unless distributed protection is actually configured", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("YIYI_PLATFORM_RATE_LIMITED", "true");
    const response = await rankRoute(new Request("http://localhost/api/outfits/rank", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(routeBody) }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("PUBLIC_PROTECTION_REQUIRED");
  });

  it("accepts production requests only after a real distributed limiter consumes a budget unit", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("AI_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "live");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ result: 1 }, { result: 1 }, { result: 60_000 }]), { status: 200, headers: { "content-type": "application/json" } }));
    const response = await rankRoute(new Request("http://localhost/api/outfits/rank", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(routeBody) }));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://example.upstash.io/pipeline", expect.objectContaining({ method: "POST", cache: "no-store" }));
  });

  it("substitutes structured context for a blank utterance and rejects unknown provider IDs", async () => {
    const candidate = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" }).deterministicAnswer;
    renderMock.mockResolvedValue({ dataUrl: "data:image/webp;base64,AA==", bytes: 2, width: 512, height: 640 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      requestId: "99999999-9999-4999-8999-999999999998",
      ranking: { selectedCandidateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mainReason: "Invalid", candidateScores: [] },
      source: "live",
      model: "gpt-5.6",
      diagnostics: { requestId: "99999999-9999-4999-8999-999999999998", boardBytes: 2, candidateCount: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const intent = { ...demoIntent, freeformSummary: "" };
    const ranked = await rankOutfits({ candidates: [candidate], wardrobe: demoWardrobe, intent, originalUtterance: " ", preferenceSummary: "", weather: null });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { originalUtterance: string };
    expect(requestBody.originalUtterance).toBe("Structured daily outfit request.");
    expect(ranked).toMatchObject({ source: "fallback", model: null, diagnosticCode: "INVALID_RANK_IDS" });
    expect(ranked.outfit.id).toBe(candidate.id);
  });

  it("fails over before fetch when any rendered board exceeds the API contract", async () => {
    const candidate = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" }).deterministicAnswer;
    renderMock.mockResolvedValue({ dataUrl: "data:image/webp;base64,AA==", bytes: 240_001, width: 512, height: 640 });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const ranked = await rankOutfits({ candidates: [candidate], wardrobe: demoWardrobe, intent: demoIntent, originalUtterance: demoIntent.freeformSummary, preferenceSummary: "", weather: null });
    expect(ranked).toMatchObject({ source: "fallback", diagnosticCode: "BOARD_TOO_LARGE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("combines every visual score in deterministic code instead of trusting the model selection", async () => {
    const candidates = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" }).candidates.slice(0, 2);
    const strong = { ...candidates[0], deterministicScore: 95, scoreTrace: candidates[0].scoreTrace ? { ...candidates[0].scoreTrace, deterministicTotal: 0.95 } : undefined };
    const weak = { ...candidates[1], deterministicScore: 70, scoreTrace: candidates[1].scoreTrace ? { ...candidates[1].scoreTrace, deterministicTotal: 0.7 } : undefined };
    renderMock.mockResolvedValue({ dataUrl: "data:image/webp;base64,AA==", bytes: 2, width: 512, height: 640 });
    const visual = (candidateId: string, value: number) => ({ candidateId, visualCoherence: value, colorBalance: value, silhouetteBalance: value, materialHarmony: value, styleClarity: value, reason: `Visual reason ${value}`, concerns: value < 0.7 ? ["Low visual clarity"] : [] });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      requestId: "99999999-9999-4999-8999-999999999997",
      ranking: { selectedCandidateId: weak.id, mainReason: "Model preferred the weaker deterministic candidate", candidateScores: [visual(strong.id, 0.5), visual(weak.id, 1)] },
      source: "live",
      model: "gpt-5.6",
      diagnostics: { requestId: "99999999-9999-4999-8999-999999999997", boardBytes: 4, candidateCount: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const ranked = await rankOutfits({ candidates: [strong, weak], wardrobe: demoWardrobe, intent: demoIntent, originalUtterance: demoIntent.freeformSummary, preferenceSummary: "", weather: null });
    expect(ranked.outfit.id).toBe(strong.id);
    expect(ranked.outfit.scoreTrace?.finalTotal).toBeCloseTo(0.815);
    expect(ranked.outfit.reason).toBe("Visual reason 0.5");
    expect(ranked.outfit.scoreTrace?.visualEvidence).toEqual({ reason: "Visual reason 0.5", concerns: ["Low visual clarity"] });
    expect(ranked).toMatchObject({ source: "live", model: "gpt-5.6" });
  });
});
