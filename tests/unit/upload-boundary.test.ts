import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as processWardrobeItem } from "@/app/api/wardrobe/process/route";

async function requestWith(bytes: Uint8Array, type = "image/png") {
  const form = new FormData();
  form.set("image", new File([bytes.slice().buffer as ArrayBuffer], "item", { type }));
  const request = new Request("http://localhost/api/wardrobe/process", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "x-forwarded-for": crypto.randomUUID() } });
  vi.spyOn(request, "formData").mockResolvedValue(form);
  return processWardrobeItem(request);
}

describe("wardrobe upload trust boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects arbitrary ftyp brands rather than treating them as HEIC", async () => {
    vi.stubEnv("AI_MODE", "mock");
    const bytes = new Uint8Array(24);
    bytes.set(new TextEncoder().encode("ftypjunk"), 4);
    const response = await requestWith(bytes, "image/heic");
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "UNSUPPORTED_IMAGE" } });
  });

  it("rejects valid-looking magic with corrupt image geometry before a provider call", async () => {
    vi.stubEnv("AI_MODE", "mock");
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await requestWith(bytes);
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_IMAGE" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
