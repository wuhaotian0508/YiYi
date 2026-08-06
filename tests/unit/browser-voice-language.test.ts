import { afterEach, describe, expect, it, vi } from "vitest";
import { interpretBrowserVoiceTranscript } from "@/lib/realtime/browser-voice-language";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser voice language bridge", () => {
  it("sends the browser transcript to the server language route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "11111111-1111-4111-8111-111111111111",
      source: "live",
      model: "gpt-5.5",
      interpretation: {
        activityPhrases: ["dinner"],
        desiredFeelings: ["polished"],
        exclusions: ["heels"],
        wardrobeAnchors: ["black blazer"],
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(interpretBrowserVoiceTranscript("Dinner tonight, no heels.")).resolves.toEqual({
      userRequest: "Dinner tonight, no heels.",
      activityPhrases: ["dinner"],
      desiredFeelings: ["polished"],
      exclusions: ["heels"],
      wardrobeAnchors: ["black blazer"],
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/voice/interpret", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }));
  });
});
