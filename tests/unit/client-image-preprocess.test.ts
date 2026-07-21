import { afterEach, describe, expect, it, vi } from "vitest";
import { preprocessWardrobeImage } from "@/lib/images/client-preprocess";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("client wardrobe image preprocessing", () => {
  it("never returns a raw HEIC when browser decoding is unavailable", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("unsupported")));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    class BrokenImage {
      naturalWidth = 0;
      naturalHeight = 0;
      src = "";
      decode() { return Promise.reject(new Error("unsupported")); }
    }
    vi.stubGlobal("Image", BrokenImage);
    const input = new File([new Uint8Array(32)], "camera.heic", { type: "image/heic" });

    await expect(preprocessWardrobeImage(input)).rejects.toMatchObject({
      code: "IMAGE_DECODE_UNSUPPORTED",
      message: expect.stringContaining("JPEG"),
    });
  });

  it("re-encodes a decoded JPEG instead of trusting its client MIME or original bytes", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 800, height: 600, close }));
    const output = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
    const context = { drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), toBlob: (callback: BlobCallback) => callback(output) };
    vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const input = new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", { type: "application/octet-stream" });

    await expect(preprocessWardrobeImage(input)).resolves.toBe(output);
    expect(context.drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
