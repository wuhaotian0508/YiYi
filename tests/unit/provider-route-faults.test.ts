import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ parse: vi.fn(), clientSecret: vi.fn() }));
vi.mock("openai", async (importOriginal) => ({
  ...await importOriginal<typeof import("openai")>(),
  default: class OpenAIMock {
    responses = { parse: provider.parse };
    realtime = { clientSecrets: { create: provider.clientSecret } };
  },
}));

import { POST as rankOutfits } from "@/app/api/outfits/rank/route";
import { POST as createRealtimeToken } from "@/app/api/realtime/token/route";
import { POST as processWardrobeItem } from "@/app/api/wardrobe/process/route";
import { demoIntent } from "@/mocks/wardrobe";

const candidateId = "11111111-1111-4111-8111-111111111111";
const webBytes = (buffer: Buffer) => Uint8Array.from(buffer);
const validBoard = await sharp({ create: { width: 512, height: 640, channels: 4, background: { r: 220, g: 210, b: 200, alpha: 1 } } }).webp().toBuffer();
const validWebpDataUrl = `data:image/webp;base64,${validBoard.toString("base64")}`;
const rankBody = {
  requestId: "99999999-9999-4999-8999-999999999999",
  originalUtterance: "Dinner",
  intent: demoIntent,
  preferences: { summary: "Neutral" },
  weather: null,
  candidates: [{ id: candidateId, itemIds: ["22222222-2222-4222-8222-222222222221", "33333333-3333-4333-8333-333333333331", "44444444-4444-4444-8444-444444444441"], deterministicScore: 80, boardDataUrl: validWebpDataUrl, boardBytes: validBoard.byteLength, boardWidth: 512, boardHeight: 640 }],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  provider.parse.mockReset();
  provider.clientSecret.mockReset();
});

describe("paid provider fault boundaries", () => {
  it("configures the Realtime token for conservative automatic interruption", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "live");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    provider.clientSecret.mockResolvedValue({ value: "ek_test-only", expires_at: 1_800_000_000 });

    const response = await createRealtimeToken(new Request("http://localhost/api/realtime/token", { method: "POST", headers: { "x-forwarded-for": crypto.randomUUID() } }));

    expect(response.status).toBe(200);
    expect(provider.clientSecret).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({
        audio: expect.objectContaining({
          input: expect.objectContaining({
            turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: false, interrupt_response: false },
          }),
        }),
      }),
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("maps a Realtime provider failure to one structured 502 without exposing provider text", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "live");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    provider.clientSecret.mockRejectedValue(Object.assign(new Error("secret provider detail"), { status: 401, code: "invalid_api_key" }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await createRealtimeToken(new Request("http://localhost/api/realtime/token", { method: "POST", headers: { "x-forwarded-for": crypto.randomUUID() } }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ error: { code: "TOKEN_PROVIDER_FAILED", retryable: true } });
    expect(JSON.stringify(body)).not.toContain("secret provider detail");
    expect(provider.clientSecret).toHaveBeenCalledTimes(1);
  });

  it("maps a Sol timeout to a labeled API failure after one provider call", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    provider.parse.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await rankOutfits(new Request("http://localhost/api/outfits/rank", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() }, body: JSON.stringify(rankBody) }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "RANK_PROVIDER_FAILED", retryable: true } });
    expect(provider.parse).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed Photoroom output before Terra and makes no second paid call", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("PHOTOROOM_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));
    const input = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const form = new FormData();
    form.set("image", new File([webBytes(input)], "item.png", { type: "image/png" }));
    const request = new Request("http://localhost/api/wardrobe/process", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "x-forwarded-for": crypto.randomUUID() } });
    vi.spyOn(request, "formData").mockResolvedValue(form);
    const response = await processWardrobeItem(request);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(502);
    expect(body).toMatchObject({ error: { code: "INVALID_BACKGROUND_REMOVAL_OUTPUT", retryable: true } });
    expect(provider.parse).not.toHaveBeenCalled();
  });

  it("classifies unsupported and malformed multipart before image processing", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "mock");
    const unsupported = await processWardrobeItem(new Request("http://localhost/api/wardrobe/process", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() },
      body: "{}",
    }));
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });

    const malformed = await processWardrobeItem(new Request("http://localhost/api/wardrobe/process", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=broken", "x-forwarded-for": crypto.randomUUID() },
      body: "not-a-valid-multipart-body",
    }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "INVALID_MULTIPART" } });
  });

  it("keeps a missing multipart image distinct from parsing failures", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "mock");
    const form = new FormData();
    form.set("note", "no image");
    const response = await processWardrobeItem(new Request("http://localhost/api/wardrobe/process", { method: "POST", headers: { "x-forwarded-for": crypto.randomUUID() }, body: form }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "IMAGE_REQUIRED" } });
  });

  it("rejects a valid-looking Photoroom image with a non-image content type", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("PHOTOROOM_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cutout = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).webp().toBuffer();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(webBytes(cutout), { status: 200, headers: { "Content-Type": "text/html" } }));
    const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer();
    const form = new FormData();
    form.set("image", new File([webBytes(input)], "item.jpg", { type: "image/jpeg" }));
    const request = new Request("http://localhost/api/wardrobe/process", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "x-forwarded-for": crypto.randomUUID() } });
    vi.spyOn(request, "formData").mockResolvedValue(form);
    const response = await processWardrobeItem(request);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_BACKGROUND_REMOVAL_OUTPUT" } });
    expect(provider.parse).not.toHaveBeenCalled();
  });

  it("rejects an oversized Photoroom pixel surface before Terra", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("PHOTOROOM_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cutout = await sharp({ create: { width: 3000, height: 3000, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).webp().toBuffer();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(webBytes(cutout), { status: 200, headers: { "Content-Type": "image/webp" } }));
    const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer();
    const form = new FormData();
    form.set("image", new File([webBytes(input)], "item.jpg", { type: "image/jpeg" }));
    const request = new Request("http://localhost/api/wardrobe/process", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "x-forwarded-for": crypto.randomUUID() } });
    vi.spyOn(request, "formData").mockResolvedValue(form);
    const response = await processWardrobeItem(request);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_BACKGROUND_REMOVAL_OUTPUT" } });
    expect(provider.parse).not.toHaveBeenCalled();
  });

  it("rejects a Photoroom body whose declared byte size exceeds the response cap", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("PHOTOROOM_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cutout = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).webp().toBuffer();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(webBytes(cutout), { status: 200, headers: { "Content-Type": "image/webp", "Content-Length": "5000001" } }));
    const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer();
    const form = new FormData();
    form.set("image", new File([webBytes(input)], "item.jpg", { type: "image/jpeg" }));
    const request = new Request("http://localhost/api/wardrobe/process", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "x-forwarded-for": crypto.randomUUID() } });
    vi.spyOn(request, "formData").mockResolvedValue(form);
    const response = await processWardrobeItem(request);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_BACKGROUND_REMOVAL_OUTPUT" } });
    expect(provider.parse).not.toHaveBeenCalled();
  });

  it("forwards the server-detected JPEG MIME instead of a forged client file.type", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("PHOTOROOM_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let forwardedType: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const forwarded = (init?.body as FormData).get("image_file");
      forwardedType = forwarded instanceof File ? forwarded.type : undefined;
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "image/webp" } });
    });
    const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer();
    const form = new FormData();
    form.set("image", new File([webBytes(input)], "forged.png", { type: "image/png" }));
    const request = new Request("http://localhost/api/wardrobe/process", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "x-forwarded-for": crypto.randomUUID() } });
    vi.spyOn(request, "formData").mockResolvedValue(form);
    await processWardrobeItem(request);
    expect(forwardedType).toBe("image/jpeg");
  });

  it("preserves a valid Photoroom cutout for manual Review when Terra output is malformed", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("PHOTOROOM_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const cutout = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 120, g: 80, b: 40, alpha: 1 } } }).webp().toBuffer();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(webBytes(cutout), { status: 200, headers: { "Content-Type": "image/webp" } }));
    provider.parse.mockResolvedValue({ output_parsed: { invented: true }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
    const input = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const form = new FormData();
    form.set("image", new File([webBytes(input)], "item.png", { type: "image/png" }));
    const request = new Request("http://localhost/api/wardrobe/process", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "x-forwarded-for": crypto.randomUUID() } });
    vi.spyOn(request, "formData").mockResolvedValue(form);
    const response = await processWardrobeItem(request);
    const body = await response.json();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(response.status, `${JSON.stringify(body)} ${String(errorLog.mock.calls.at(-1)?.[0])}`).toBe(200);
    expect(provider.parse, `${JSON.stringify(body)} ${String(errorLog.mock.calls.at(-1)?.[0])}`).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      source: { cutout: "photoroom", analysis: "manual-review" },
      analysisStatus: "needs-review",
      diagnostics: { analysisErrorCode: "INVALID_ITEM_ANALYSIS_OUTPUT" },
    });
    expect(body.cutoutDataUrl).toMatch(/^data:image\/webp;base64,/);
  });
});
