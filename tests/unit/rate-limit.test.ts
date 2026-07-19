import { afterEach, describe, expect, it, vi } from "vitest";
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
});
