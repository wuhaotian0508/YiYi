import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shopifyImageFile } from "@/lib/wardrobe/shopify-client";

describe("Add wardrobe Shopify queue", () => {
  it("exposes purchase import and feeds only downloaded Files into the existing processor", () => {
    const source = readFileSync("src/app/wardrobe/add/page.tsx", "utf8");

    expect(source).toContain("Import purchases from Shopify");
    expect(source).toContain("<ShopifyPurchaseImport");
    expect(source).toContain("onFiles={beginFiles}");
    expect(source).toContain("await preprocessWardrobeImage(file)");
    expect(source).toContain("await requestProcessing(normalized, file.name)");
  });

  it("advances to the next queued File only after a successful Dexie save", () => {
    const source = readFileSync("src/app/wardrobe/add/page.tsx", "utf8");
    const saveIndex = source.indexOf("await savePersonalWardrobeItem(item, images)");
    const readbackIndex = source.indexOf("WARDROBE_SAVE_READBACK_FAILED");
    const advanceIndex = source.indexOf("await finishCurrentItem()", saveIndex);

    expect(saveIndex).toBeGreaterThan(-1);
    expect(readbackIndex).toBeGreaterThan(saveIndex);
    expect(advanceIndex).toBeGreaterThan(readbackIndex);
    expect(source).toContain("await processFile(nextFile, nextIndex, queueRef.current.length)");
  });

  it("creates generic image Files without embedding Shopify identifiers or suggestions", async () => {
    const source = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
      type: "image/jpeg",
    });

    const file = shopifyImageFile(source, 0);

    expect(file.name).toBe("shopify-purchase-1.jpg");
    expect(file.name).not.toContain("gid://");
    expect(file.name).not.toContain("AI Test");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff]),
    );
  });
});
