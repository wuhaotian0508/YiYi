import { describe, expect, it } from "vitest";
import { GET as imageHealth } from "@/app/api/health/image/route";
import { sharpRuntimeSmoke } from "@/lib/images/sharp-runtime";
import { shouldRetryWardrobeProcessing } from "@/lib/wardrobe/process-client";

describe("image runtime and upload retry policy", () => {
  it("executes a real in-memory WebP conversion through the server Sharp runtime", async () => {
    await expect(sharpRuntimeSmoke()).resolves.toMatchObject({ format: "webp", width: 2, height: 2, sharp: "0.35.3" });
    const response = await imageHealth();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ready: true, runtime: { format: "webp", width: 2, height: 2, sharp: "0.35.3" } });
  });

  it("retries only the explicitly transient Photoroom boundary", () => {
    expect(shouldRetryWardrobeProcessing(502, "BACKGROUND_REMOVAL_FAILED", true)).toBe(true);
    expect(shouldRetryWardrobeProcessing(503, "IMAGE_RUNTIME_UNAVAILABLE", false)).toBe(false);
    expect(shouldRetryWardrobeProcessing(502, "INVALID_BACKGROUND_REMOVAL_OUTPUT", true)).toBe(false);
    expect(shouldRetryWardrobeProcessing(500, "PROCESSING_FAILED", true)).toBe(false);
    expect(shouldRetryWardrobeProcessing(429, "RATE_LIMITED", true)).toBe(false);
  });
});
