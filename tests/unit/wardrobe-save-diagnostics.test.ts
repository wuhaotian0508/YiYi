import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/diagnostics/wardrobe-save/route";
import { createWardrobeLocalSaveDiagnostic } from "@/lib/wardrobe/local-save-diagnostics";

afterEach(() => vi.restoreAllMocks());

describe("wardrobe local save diagnostics", () => {
  it("reports only bounded metadata and redacts image or token material", async () => {
    Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate: vi.fn().mockResolvedValue({ usage: 200, quota: 1_000 }) } });
    const inner = Object.assign(new Error("data:image/png;base64,AAAA"), { name: "AbortError" });
    const error = Object.assign(new Error("failed with sk_private-secret"), { inner });
    const diagnostic = await createWardrobeLocalSaveDiagnostic({
      requestId: "99999999-9999-4999-8999-999999999999",
      stage: "indexeddb-transaction",
      errorCode: "LOCAL_SAVE_FAILED",
      error,
      completedStages: ["schema", "thumbnail"],
      originalBlob: new Blob([new Uint8Array(12)], { type: "image/jpeg" }),
      cutoutBlob: new Blob([new Uint8Array(8)], { type: "image/webp" }),
      thumbnailBlob: null,
      databaseVersion: 7,
    });

    expect(diagnostic).toMatchObject({
      errorMessage: "failed with [redacted-token]",
      innerErrorMessage: "[redacted-image]",
      blobs: { original: { mime: "image/jpeg", bytes: 12 }, cutout: { mime: "image/webp", bytes: 8 }, thumbnail: null },
      storage: { usage: 200, quota: 1_000 },
      databaseVersion: 7,
    });
    expect(JSON.stringify(diagnostic)).not.toContain("AAAA");
    expect(JSON.stringify(diagnostic)).not.toContain("private-secret");
  });

  it("accepts a strict same-origin diagnostic and rejects image payload fields", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const valid = {
      requestId: "99999999-9999-4999-8999-999999999999",
      stage: "indexeddb-readback",
      errorCode: "LOCAL_SAVE_READBACK_FAILED",
      errorName: "Error",
      errorMessage: "readback failed",
      innerErrorName: null,
      innerErrorMessage: null,
      completedStages: ["schema"],
      blobs: { original: null, cutout: { mime: "image/webp", bytes: 8 }, thumbnail: { mime: "image/png", bytes: 4 } },
      storage: { usage: null, quota: null },
      databaseVersion: 7,
    };
    const response = await POST(new Request("https://yiyi.example/api/diagnostics/wardrobe-save", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://yiyi.example", host: "yiyi.example" },
      body: JSON.stringify(valid),
    }));
    expect(response.status).toBe(202);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(valid.requestId));

    const rejected = await POST(new Request("https://yiyi.example/api/diagnostics/wardrobe-save", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://yiyi.example", host: "yiyi.example" },
      body: JSON.stringify({ ...valid, imageData: "data:image/png;base64,AAAA" }),
    }));
    expect(rejected.status).toBe(400);
  });
});
