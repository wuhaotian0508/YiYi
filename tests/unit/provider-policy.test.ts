import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { WardrobeAnalysisProviderSchema } from "@/domain/schemas";
import { openAIClientOptions, providerTimeoutMs } from "@/lib/api/provider-policy";

describe("provider cost and timeout policy", () => {
  it("can compile the Terra output contract as an OpenAI strict schema", () => {
    expect(() => zodTextFormat(WardrobeAnalysisProviderSchema, "wardrobe_analysis")).not.toThrow();
  });

  it("disables hidden SDK retries and keeps every paid stage bounded", () => {
    expect(openAIClientOptions("test-key")).toEqual({ apiKey: "test-key", maxRetries: 0 });
    expect(providerTimeoutMs).toEqual({ realtimeToken: 10_000, itemAnalysis: 20_000, outfitRanking: 20_000 });
    expect(Object.values(providerTimeoutMs).every((value) => value > 0 && value <= 20_000)).toBe(true);
  });
});
