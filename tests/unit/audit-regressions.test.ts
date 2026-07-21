import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getWeather } from "@/app/api/weather/route";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { logApiDiagnostic, safeErrorMetadata } from "@/lib/api/diagnostics";
import { OpenAIRealtimeVoiceAdapter, resolveAvailabilityItemId, yiyiTurnDetection, type VoiceToolHandlers } from "@/lib/realtime/voice-session";
import { shouldSeedDemoWardrobe } from "@/lib/storage/db";
import { demoIntent } from "@/mocks/wardrobe";
import { copy } from "@/content/copy";
import { configuredWeatherMode, resolveWeatherForSession } from "@/lib/weather/client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

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

  it("uses eager semantic turn detection for the first recommendation with automatic response and interruption", () => {
    expect(yiyiTurnDetection).toEqual({
      type: "semantic_vad",
      eagerness: "high",
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

  it("reuses one pending live voice connection instead of requesting another token", async () => {
    const handlers: VoiceToolHandlers = {
      requestRecommendation: async () => ({ success: false, summary: "unused" }),
      revise: async () => ({ success: false, summary: "unused" }),
      confirm: async () => ({ success: false, summary: "unused" }),
      setAvailability: async () => ({ success: false, summary: "unused" }),
      savePreference: async () => ({ success: false, summary: "unused" }),
    };
    let tokenRequests = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      tokenRequests += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers);

    const first = adapter.connect();
    const second = adapter.connect();
    await Promise.resolve();

    expect(tokenRequests).toBe(1);
    expect(second).toBe(first);
    await adapter.disconnect();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    fetchSpy.mockRestore();
  });

  it("preserves token 429 status and Retry-After without retrying", async () => {
    const handlers: VoiceToolHandlers = {
      requestRecommendation: async () => ({ success: false, summary: "unused" }),
      revise: async () => ({ success: false, summary: "unused" }),
      confirm: async () => ({ success: false, summary: "unused" }),
      setAvailability: async () => ({ success: false, summary: "unused" }),
      savePreference: async () => ({ success: false, summary: "unused" }),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      requestId: "99999999-9999-4999-8999-999999999999",
      error: { code: "RATE_LIMITED", message: "Try again later.", retryable: true },
    }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "17" } }));
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers);

    await expect(adapter.connect()).rejects.toMatchObject({
      name: "VoiceConnectionFailure",
      stage: "token",
      code: "RATE_LIMITED",
      httpStatus: 429,
      retryAfterMs: 17_000,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns fixed demo weather when Today supplies no coordinates", async () => {
    const response = await getWeather(new Request("http://localhost/api/weather"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.source).toBe("fixed-demo");
    expect(payload.weather.summary).toBe("58° · Light rain");
  });

  it("makes competition demo weather explicit and restores persisted weather only when fresh weather fails", () => {
    vi.stubEnv("NEXT_PUBLIC_WEATHER_MODE", "fixed-demo");
    const fresh = { minApparentTempC: 10, maxApparentTempC: 14, precipitationProbability: 5, expectedRain: false, windy: false, summary: "Fresh", sourceTimestamp: 2 };
    const persisted = { ...fresh, summary: "Persisted", sourceTimestamp: 1 };
    expect(configuredWeatherMode()).toBe("fixed-demo");
    expect(resolveWeatherForSession(fresh, persisted)).toBe(fresh);
    expect(resolveWeatherForSession(null, persisted)).toBe(persisted);
    expect(resolveWeatherForSession(null, null)).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_WEATHER_MODE", "device-location");
    expect(configuredWeatherMode()).toBe("invalid");
  });

  it("rejects either half of a coordinate pair without calling the provider", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected provider call"));
    for (const query of ["latitude=37.8", "longitude=-122.2"]) {
      const response = await getWeather(new Request(`http://localhost/api/weather?${query}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_LOCATION", retryable: false } });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the next twelve provider hours at night instead of the first twelve of the day", async () => {
    const now = Date.parse("2026-07-21T03:30:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const hour = 60 * 60;
    const firstEpochSecond = Math.floor(now / 1_000) - (20 * hour) - (30 * 60);
    const times = Array.from({ length: 48 }, (_, index) => firstEpochSecond + index * hour);
    const values = times.map((_, index) => index);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      timezone: "America/Los_Angeles",
      utc_offset_seconds: -25_200,
      hourly: {
        time: times,
        apparent_temperature: values,
        precipitation_probability: values,
        wind_speed_10m: values,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await getWeather(new Request("http://localhost/api/weather?latitude=37.7&longitude=-122.4"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.weather).toMatchObject({ minApparentTempC: 21, maxApparentTempC: 32, precipitationProbability: 32, sourceTimestamp: times[21] * 1_000 });
    const providerUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(providerUrl.searchParams.get("forecast_days")).toBe("2");
    expect(providerUrl.searchParams.get("timeformat")).toBe("unixtime");
  });

  it("rejects non-empty hourly arrays whose lengths do not match hourly.time", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      timezone: "UTC",
      utc_offset_seconds: 0,
      hourly: { time: [1_800_000_000, 1_800_003_600], apparent_temperature: [10], precipitation_probability: [0, 0], wind_speed_10m: [1, 1] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = await getWeather(new Request("http://localhost/api/weather?latitude=37.7&longitude=-122.4"));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "WEATHER_FAILED" } });
  });

  it("returns a bounded structured failure for malformed live weather data", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ hourly: { apparent_temperature: "bad" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = await getWeather(new Request("http://localhost/api/weather?latitude=37.7&longitude=-122.4"));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "WEATHER_FAILED", retryable: true } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
      recommendationOperationId: "session-1:operation-2",
      profileVersion: 7,
      outfitVersion: "11111111-1111-4111-8111-111111111111",
    });
    const serialized = String(spy.mock.calls[0]?.[0]);
    expect(serialized).toContain("99999999-9999-4999-8999-999999999999");
    expect(serialized).toContain("RANK_PROVIDER_FAILED");
    expect(serialized).toContain("invalid_image");
    expect(serialized).toContain("req_safe123");
    expect(serialized).toContain("session-1:operation-2");
    expect(serialized).toContain('"profileVersion":7');
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("data:image");
    spy.mockRestore();
  });
});
