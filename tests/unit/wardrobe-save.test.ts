// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemImageSetSchema, WardrobeItemSchema } from "@/domain/schemas";
import { db, getExperienceMode, getItemImageSet, getOnboardingState, pruneProcessingJobs, savePersonalWardrobeItem } from "@/lib/storage/db";
import { demoWardrobe } from "@/mocks/wardrobe";

const personalItem = WardrobeItemSchema.parse({
  ...demoWardrobe[0],
  id: "91919191-9191-4191-8191-919191919191",
  dataProvenance: "personal",
  createdAt: 10,
  updatedAt: 10,
});
const originalBlob = new Blob([new Uint8Array(1_200_000)], { type: "image/jpeg" });
const cutoutBlob = new Blob([new Uint8Array(420_000)], { type: "image/webp" });
const thumbnailBlob = new Blob([new Uint8Array(48_000)], { type: "image/png" });
const imageSet = ItemImageSetSchema.parse({ itemId: personalItem.id, originalBlob, cutoutBlob, thumbnailBlob, width: 1024, height: 768, createdAt: 10, updatedAt: 10 });

describe("atomic personal wardrobe save", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  afterEach(async () => { await db.delete(); });

  it("commits item, image and Personal mode together and removes only Demo data", async () => {
    await db.wardrobeItems.bulkPut(demoWardrobe.map((item) => ({ ...item, dataProvenance: "demo" as const })));
    await db.appSettings.put({ key: "experienceMode", value: "demo" });
    await db.appSettings.put({ key: "onboardingState", value: JSON.stringify({ status: "complete", version: 1, completedAt: 1, experienceMode: "demo" }) });

    await expect(savePersonalWardrobeItem(personalItem, imageSet)).resolves.toMatchObject({ itemId: personalItem.id, alreadySaved: false });
    expect(await db.wardrobeItems.toArray()).toEqual([personalItem]);
    expect(await db.itemImages.get(personalItem.id)).toMatchObject({ itemId: personalItem.id, width: 1024, height: 768, createdAt: 10, updatedAt: 10 });
    expect(await getExperienceMode()).toBe("personal");
    expect((await getOnboardingState()).experienceMode).toBe("personal");
  });

  it("makes a repeated submission idempotent without duplicating records", async () => {
    await savePersonalWardrobeItem(personalItem, imageSet);
    await expect(savePersonalWardrobeItem(personalItem, imageSet)).resolves.toMatchObject({ itemId: personalItem.id, alreadySaved: true });
    expect(await db.wardrobeItems.count()).toBe(1);
    expect(await db.itemImages.count()).toBe(1);
  });

  it("rejects a partial prior record instead of claiming a successful save", async () => {
    await db.wardrobeItems.put(personalItem);
    await expect(savePersonalWardrobeItem(personalItem, imageSet)).rejects.toThrow("PARTIAL_WARDROBE_RECORD");
    expect(await db.itemImages.get(personalItem.id)).toBeUndefined();
  });

  it("rolls back the item when the required image record cannot be committed", async () => {
    vi.spyOn(db.itemImages, "add").mockRejectedValueOnce(new Error("image write failed"));
    await expect(savePersonalWardrobeItem(personalItem, imageSet)).rejects.toThrow("image write failed");
    expect(await db.wardrobeItems.get(personalItem.id)).toBeUndefined();
    expect(await db.itemImages.get(personalItem.id)).toBeUndefined();
  });

  it("does not let unrelated Demo cleanup failure roll back the core item and required images", async () => {
    await db.wardrobeItems.bulkPut(demoWardrobe.map((item) => ({ ...item, dataProvenance: "demo" as const })));
    await db.appSettings.put({ key: "experienceMode", value: "demo" });
    vi.spyOn(db.preferenceProfiles, "get").mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(savePersonalWardrobeItem(personalItem, imageSet)).resolves.toMatchObject({
      itemId: personalItem.id,
      alreadySaved: false,
      cleanupPending: true,
    });
    expect(await db.wardrobeItems.get(personalItem.id)).toEqual(personalItem);
    expect(await db.itemImages.get(personalItem.id)).toMatchObject({ itemId: personalItem.id });
    expect(await getExperienceMode()).toBe("personal");
  });

  it("keeps the required cutout and thumbnail committed when optional original persistence fails", async () => {
    vi.spyOn(db.itemImages, "update").mockRejectedValueOnce(new DOMException("Quota", "QuotaExceededError"));

    await expect(savePersonalWardrobeItem(personalItem, imageSet)).resolves.toMatchObject({
      itemId: personalItem.id,
      originalStored: false,
    });
    const stored = await getItemImageSet(personalItem.id);
    expect(stored?.cutoutBlob).toBeInstanceOf(Blob);
    expect(stored?.thumbnailBlob).toBeInstanceOf(Blob);
    expect(stored?.originalBlob).toBeUndefined();
  });

  it("prunes stale processing jobs without touching recent work", async () => {
    await db.processingJobs.bulkPut([{ id: "old", status: "failed", createdAt: 1 }, { id: "new", status: "processing", createdAt: 100 }]);
    await expect(pruneProcessingJobs(110, 20)).resolves.toBe(1);
    expect((await db.processingJobs.toArray()).map((job) => job.id)).toEqual(["new"]);
  });
});
