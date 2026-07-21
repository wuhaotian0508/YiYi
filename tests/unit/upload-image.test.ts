import { describe, expect, it, vi } from "vitest";
import { encodeCanvasWithinUploadLimit, MAX_UPLOAD_BYTES } from "@/lib/images/prepare-upload";

function fakeCanvas(sizes: number[]) {
  return {
    width: 2048,
    height: 1536,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (callback: BlobCallback) => {
      const size = sizes.shift() ?? 0;
      callback(new Blob([new Uint8Array(size)], { type: "image/webp" }));
    },
  } as unknown as HTMLCanvasElement;
}

describe("wardrobe image preparation", () => {
  it("falls back to PNG when Safari cannot produce a usable WebP Blob", async () => {
    const attempts: string[] = [];
    const canvas = {
      toBlob: (callback: BlobCallback, type?: string) => {
        attempts.push(type ?? "");
        callback(type === "image/webp" ? null : new Blob([new Uint8Array(12)], { type: type ?? "" }));
      },
    } as HTMLCanvasElement;

    const { canvasToBlob } = await import("@/lib/images/prepare-upload");
    await expect(canvasToBlob(canvas, "image/webp", 0.78)).resolves.toMatchObject({ type: "image/png", size: 12 });
    expect(attempts).toEqual(["image/webp", "image/png"]);
  });

  it("keeps reducing a detailed image until the encoded upload is under the client limit", async () => {
    const source = fakeCanvas([MAX_UPLOAD_BYTES + 100, MAX_UPLOAD_BYTES + 50]);
    const resized = fakeCanvas([MAX_UPLOAD_BYTES - 1]);
    const createElement = vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName === "canvas") return resized;
      return document.createElement(tagName);
    }) as typeof document.createElement);

    await expect(encodeCanvasWithinUploadLimit(source)).resolves.toHaveProperty("size", MAX_UPLOAD_BYTES - 1);
    expect(createElement).toHaveBeenCalledWith("canvas");
    createElement.mockRestore();
  });

  it("fails locally instead of uploading an image that remains oversized", async () => {
    const oversized = Array.from({ length: 8 }, () => MAX_UPLOAD_BYTES + 1);
    const source = fakeCanvas(oversized);
    const createElement = vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName === "canvas") return source;
      return document.createElement(tagName);
    }) as typeof document.createElement);

    await expect(encodeCanvasWithinUploadLimit(source)).rejects.toThrow("could not be reduced below 4 MB");
    createElement.mockRestore();
  });
});
