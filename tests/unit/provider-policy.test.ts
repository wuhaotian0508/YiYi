import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { WardrobeAnalysisProviderSchema } from "@/domain/schemas";
import { openAIClientOptions, providerTimeoutMs } from "@/lib/api/provider-policy";

describe("provider cost and timeout policy", () => {
  it("can compile the Terra output contract as an OpenAI strict schema", () => {
    expect(() => zodTextFormat(WardrobeAnalysisProviderSchema, "wardrobe_analysis")).not.toThrow();
  });

  it("pins SDK-backed calls to OpenAI, disables hidden retries, and keeps every paid stage bounded", () => {
    expect(openAIClientOptions("test-key")).toEqual({ apiKey: "test-key", baseURL: "https://api.openai.com/v1", maxRetries: 0 });
    expect(providerTimeoutMs).toEqual({ realtimeToken: 10_000, itemAnalysis: 20_000, outfitRanking: 26_000 });
    expect(Object.values(providerTimeoutMs).every((value) => value > 0 && value <= 30_000)).toBe(true);
    // Ranking must finish inside the Realtime outfit tool budget (40s), or the
    // turn is abandoned before the ranked answer can be committed.
    expect(providerTimeoutMs.outfitRanking).toBeLessThan(40_000);
  });
});
