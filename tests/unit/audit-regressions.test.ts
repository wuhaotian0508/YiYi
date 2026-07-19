import { describe, expect, it, vi } from "vitest";
import { GET as getWeather } from "@/app/api/weather/route";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { logApiDiagnostic, safeErrorMetadata } from "@/lib/api/diagnostics";
import { OpenAIRealtimeVoiceAdapter, resolveAvailabilityItemId, yiyiTurnDetection, type VoiceToolHandlers } from "@/lib/realtime/voice-session";
import { shouldSeedDemoWardrobe } from "@/lib/storage/db";
import { demoIntent } from "@/mocks/wardrobe";
import { copy } from "@/content/copy";

describe("audit regressions", () => {
  it("seeds demo clothes once, but never for personal mode or after a completed seed", () => {
    expect(shouldSeedDemoWardrobe({ mode: null, alreadySeeded: false, itemCount: 0, environmentEnabled: true })).toBe(true);
    expect(shouldSeedDemoWardrobe({ mode: "personal", alreadySeeded: false, itemCount: 0, environmentEnabled: true })).toBe(false);
    expect(shouldSeedDemoWardrobe({ mode: "demo", alreadySeeded: true, itemCount: 0, environmentEnabled: true })).toBe(false);
    expect(shouldSeedDemoWardrobe({ mode: null, alreadySeeded: false, itemCount: 0, environmentEnabled: false })).toBe(false);
  });

  it("preserves recommendation failures in the Realtime handler contract", async () => {
    const handler: VoiceToolHandlers["requestRecommendation"] = async () => ({ success: false, summary: "No legal outfit." });
    await expect(handler(demoIntent)).resolves.toEqual({ success: false, summary: "No legal outfit." });
  });

  it("keeps personal preference defaults free of demo assumptions", () => {
    const profile = createNeutralPreferenceProfile(123);
    expect(profile.softPreferences).toEqual([]);
    expect(profile.preferredMetals).toEqual([]);
    expect(profile.evidence).toEqual([]);
    expect(copy.preferences.resetConfirm.toLowerCase()).not.toContain("demo");
  });

  it("prefers an explicit availability ID, then focus, then no target", () => {
    const explicit = "11111111-1111-4111-8111-111111111111";
    const focused = "22222222-2222-4222-8222-222222222221";
    expect(resolveAvailabilityItemId(explicit, focused)).toBe(explicit);
    expect(resolveAvailabilityItemId(null, focused)).toBe(focused);
    expect(resolveAvailabilityItemId(null, null)).toBeNull();
  });

  it("uses patient semantic turn detection with automatic response and interruption", () => {
    expect(yiyiTurnDetection).toEqual({
      type: "semantic_vad",
      eagerness: "low",
      createResponse: true,
      interruptResponse: true,
    });
  });

  it("aborts a pending token request when live voice disconnects", async () => {
    const handlers: VoiceToolHandlers = {
      requestRecommendation: async () => ({ success: false, summary: "unused" }),
      revise: async () => ({ success: false, summary: "unused" }),
      confirm: async () => ({ success: false, summary: "unused" }),
      setAvailability: async () => ({ success: false, summary: "unused" }),
      savePreference: async () => ({ success: false, summary: "unused" }),
    };
    const states: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers);
    adapter.onState((state) => states.push(state));
    const connecting = adapter.connect();
    await adapter.disconnect();
    await expect(connecting).resolves.toBeUndefined();
    expect(fetchSpy.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(states.at(-1)).toBe("idle");
    expect(states).not.toContain("error");
  });

  it("returns fixed demo weather when Today supplies no coordinates", async () => {
    const response = await getWeather(new Request("http://localhost/api/weather"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.source).toBe("fixed-demo");
    expect(payload.weather.summary).toBe("58° · Light rain");
  });

  it("logs only allowlisted diagnostic metadata, never error messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("secret-token and data:image/webp;base64,private"), { status: 429, code: "invalid_image", type: "invalid_request_error", request_id: "req_safe123" });
    const metadata = safeErrorMetadata(error);
    logApiDiagnostic({
      requestId: "99999999-9999-4999-8999-999999999999",
      route: "/api/outfits/rank",
      provider: "openai-responses",
      model: "gpt-5.6",
      outcome: "error",
      ...metadata,
      durationMs: 123.4,
      errorCode: "RANK_PROVIDER_FAILED",
    });
    const serialized = String(spy.mock.calls[0]?.[0]);
    expect(serialized).toContain("99999999-9999-4999-8999-999999999999");
    expect(serialized).toContain("RANK_PROVIDER_FAILED");
    expect(serialized).toContain("invalid_image");
    expect(serialized).toContain("req_safe123");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("data:image");
    spy.mockRestore();
  });
});
