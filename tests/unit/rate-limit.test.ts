import { describe, expect, it } from "vitest";
import { takeRateLimit } from "@/lib/api/rate-limit";

describe("API rate-limit guard", () => {
  it("allows the configured budget and then returns a retry window", () => {
    const request = new Request("http://localhost/api/test", { headers: { "x-forwarded-for": `test-${crypto.randomUUID()}` } });
    expect(takeRateLimit(request, "unit", 2, 60_000).allowed).toBe(true);
    expect(takeRateLimit(request, "unit", 2, 60_000).allowed).toBe(true);
    const blocked = takeRateLimit(request, "unit", 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
