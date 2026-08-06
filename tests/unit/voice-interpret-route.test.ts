import { afterEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/crs-responses", () => ({ requestCrsResponseText: provider.request }));

import { POST } from "@/app/api/voice/interpret/route";

afterEach(() => {
  vi.unstubAllEnvs();
  provider.request.mockReset();
});

describe("voice language interpretation route", () => {
  it("uses the configured CRS stream and returns only validated intent fields", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://crs.codeccs.com/openai");
    provider.request.mockResolvedValue({
      text: JSON.stringify({
        activityPhrases: ["dinner"],
        desiredFeelings: ["polished"],
        exclusions: ["no heels"],
        wardrobeAnchors: ["my black blazer"],
      }),
      model: "gpt-5.5",
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    });

    const response = await POST(new Request("http://localhost/api/voice/interpret", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() },
      body: JSON.stringify({ requestId: crypto.randomUUID(), transcript: "Dinner tonight, polished but no heels, use my black blazer." }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      source: "live",
      model: "gpt-5.5",
      interpretation: {
        activityPhrases: ["dinner"],
        desiredFeelings: ["polished"],
        exclusions: ["no heels"],
        wardrobeAnchors: ["my black blazer"],
      },
    });
    expect(provider.request).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "https://crs.codeccs.com/openai",
      model: "gpt-5.5",
      text: "Dinner tonight, polished but no heels, use my black blazer.",
    }));
  });
});
