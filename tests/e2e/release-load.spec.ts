import { expect, test } from "@playwright/test";

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

test.describe("mock API release load", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "One engine is sufficient for route-level load evidence.");

  test("handles an average concurrent weather burst without external calls", async ({ request }) => {
    const samples = await Promise.all(Array.from({ length: 24 }, async () => {
      const startedAt = performance.now();
      const response = await request.get("/api/weather");
      return { status: response.status(), durationMs: performance.now() - startedAt, cache: response.headers()["cache-control"] };
    }));
    expect(samples.every((sample) => sample.status === 200)).toBe(true);
    expect(samples.every((sample) => sample.cache?.includes("no-store"))).toBe(true);
    const p95 = percentile(samples.map((sample) => sample.durationMs), 0.95);
    if (process.env.YIYI_PRINT_LOAD === "true") console.log(JSON.stringify({ scenario: "weather-24-concurrent", p95Ms: p95, maxMs: Math.max(...samples.map((sample) => sample.durationMs)) }));
    expect(p95).toBeLessThan(1_000);
  });

  test("short token burst reaches the configured limiter without provider work", async ({ request }) => {
    const source = `release-burst-${crypto.randomUUID()}`;
    const responses = [];
    for (let index = 0; index < 12; index += 1) {
      responses.push(await request.post("/api/realtime/token", { headers: { "x-forwarded-for": source } }));
    }
    expect(responses.slice(0, 10).every((response) => response.status() === 409)).toBe(true);
    expect(responses.slice(10).every((response) => response.status() === 429)).toBe(true);
    expect(Number(responses[10].headers()["retry-after"])).toBeGreaterThan(0);
  });
});
