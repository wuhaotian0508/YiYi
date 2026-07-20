import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as createRealtimeToken } from "@/app/api/realtime/token/route";
import { productionProtectionReady, providerRoutesAllowed, rateLimitMode, takeRateLimit } from "@/lib/api/rate-limit";

afterEach(() => vi.unstubAllEnvs());

describe("API rate-limit guard", () => {
  it("allows the configured budget and then returns a retry window", async () => {
    const request = new Request("http://localhost/api/test", { headers: { "x-forwarded-for": `test-${crypto.randomUUID()}` } });
    expect((await takeRateLimit(request, "unit", 2, 60_000)).allowed).toBe(true);
    expect((await takeRateLimit(request, "unit", 2, 60_000)).allowed).toBe(true);
    const blocked = await takeRateLimit(request, "unit", 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("returns the standard Retry-After header when the token route is limited", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "mock");
    const headers = { "x-forwarded-for": `token-route-${crypto.randomUUID()}` };
    let response!: Response;
    for (let index = 0; index < 11; index += 1) {
      response = await createRealtimeToken(new Request("http://localhost/api/realtime/token", { method: "POST", headers }));
    }

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("logs a safe token stage correlated by attempt and generation", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "mock");
    const attemptId = crypto.randomUUID();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await createRealtimeToken(new Request("http://localhost/api/realtime/token", {
      method: "POST",
      headers: {
        "x-forwarded-for": `token-log-${crypto.randomUUID()}`,
        "x-yiyi-voice-attempt": attemptId,
        "x-yiyi-voice-generation": "7",
      },
    }));

    expect(response.status).toBe(409);
    const diagnostic = String(log.mock.calls.at(-1)?.[0]);
    expect(diagnostic).toContain(attemptId);
    expect(diagnostic).toContain('"sessionGeneration":7');
    expect(diagnostic).toContain('"voiceStage":"token"');
    expect(diagnostic).not.toContain("apiKey");
    expect(diagnostic).not.toContain("ephemeral");
  });

  it("fails closed for live production when only the per-instance map exists", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "mock");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("YIYI_PLATFORM_RATE_LIMITED", "false");
    expect(rateLimitMode()).toBe("per-instance");
    expect(productionProtectionReady()).toBe(false);
    expect(providerRoutesAllowed()).toBe(false);
    vi.stubEnv("YIYI_PLATFORM_RATE_LIMITED", "true");
    expect(rateLimitMode()).toBe("per-instance");
    expect(productionProtectionReady()).toBe(false);
  });

  it("does not report production protection as configured merely because local mock routes are allowed", () => {
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("AI_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "mock");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(productionProtectionReady()).toBe(false);
    expect(providerRoutesAllowed()).toBe(true);
  });

  it("reports distributed protection only when both Upstash credentials exist", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    expect(rateLimitMode()).toBe("upstash");
    expect(productionProtectionReady()).toBe(true);
  });

  it("fails closed with a structured response when the distributed limiter is unavailable", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "live");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("Timeout", "TimeoutError"));

    const response = await createRealtimeToken(new Request("http://localhost/api/realtime/token", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "RATE_LIMIT_UNAVAILABLE", retryable: true } });
  });
});
