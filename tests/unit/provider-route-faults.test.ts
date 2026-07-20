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
const validWebpDataUrl = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA=";
const rankBody = {
  requestId: "99999999-9999-4999-8999-999999999999",
  originalUtterance: "Dinner",
  intent: demoIntent,
  preferences: { summary: "Neutral" },
  weather: null,
  candidates: [{ id: candidateId, itemIds: ["22222222-2222-4222-8222-222222222221", "33333333-3333-4333-8333-333333333331", "44444444-4444-4444-8444-444444444441"], deterministicScore: 80, boardDataUrl: validWebpDataUrl, boardBytes: 44, boardWidth: 512, boardHeight: 640 }],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  provider.parse.mockReset();
  provider.clientSecret.mockReset();
});

describe("paid provider fault boundaries", () => {
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
    form.set("image", new File([input], "item.png", { type: "image/png" }));
    const request = new Request("http://localhost/api/wardrobe/process", { method: "POST", headers: { "x-forwarded-for": crypto.randomUUID() } });
    vi.spyOn(request, "formData").mockResolvedValue(form);
    const response = await processWardrobeItem(request);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(502);
    expect(body).toMatchObject({ error: { code: "INVALID_BACKGROUND_REMOVAL_OUTPUT", retryable: true } });
    expect(provider.parse).not.toHaveBeenCalled();
  });

  it("rejects malformed Terra output after one Photoroom and one OpenAI call", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_MODE", "live");
    vi.stubEnv("PHOTOROOM_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const cutout = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 120, g: 80, b: 40, alpha: 1 } } }).webp().toBuffer();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(cutout, { status: 200 }));
    provider.parse.mockResolvedValue({ output_parsed: { invented: true }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
    const input = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const form = new FormData();
    form.set("image", new File([input], "item.png", { type: "image/png" }));
    const request = new Request("http://localhost/api/wardrobe/process", { method: "POST", headers: { "x-forwarded-for": crypto.randomUUID() } });
    vi.spyOn(request, "formData").mockResolvedValue(form);
    const response = await processWardrobeItem(request);
    const body = await response.json();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(response.status, `${JSON.stringify(body)} ${String(errorLog.mock.calls.at(-1)?.[0])}`).toBe(502);
    expect(provider.parse).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ error: { code: "INVALID_ITEM_ANALYSIS_OUTPUT", retryable: true } });
  });
});
