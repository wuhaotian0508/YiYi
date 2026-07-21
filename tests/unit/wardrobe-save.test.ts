import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ItemImageSetSchema, WardrobeItemSchema } from "@/domain/schemas";
import { db, getExperienceMode, getOnboardingState, pruneProcessingJobs, savePersonalWardrobeItem } from "@/lib/storage/db";
import { demoWardrobe } from "@/mocks/wardrobe";

const personalItem = WardrobeItemSchema.parse({
  ...demoWardrobe[0],
  id: "91919191-9191-4191-8191-919191919191",
  dataProvenance: "personal",
  createdAt: 10,
  updatedAt: 10,
});
const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
const imageSet = ItemImageSetSchema.parse({ itemId: personalItem.id, originalBlob: blob, cutoutBlob: blob, thumbnailBlob: blob, width: 10, height: 20, createdAt: 10, updatedAt: 10 });

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

    await expect(savePersonalWardrobeItem(personalItem, imageSet)).resolves.toEqual({ itemId: personalItem.id, alreadySaved: false });
    expect(await db.wardrobeItems.toArray()).toEqual([personalItem]);
    expect(await db.itemImages.get(personalItem.id)).toMatchObject({ itemId: personalItem.id, width: 10, height: 20, createdAt: 10, updatedAt: 10 });
    expect(await getExperienceMode()).toBe("personal");
    expect((await getOnboardingState()).experienceMode).toBe("personal");
  });

  it("makes a repeated submission idempotent without duplicating records", async () => {
    await savePersonalWardrobeItem(personalItem, imageSet);
    await expect(savePersonalWardrobeItem(personalItem, imageSet)).resolves.toEqual({ itemId: personalItem.id, alreadySaved: true });
    expect(await db.wardrobeItems.count()).toBe(1);
    expect(await db.itemImages.count()).toBe(1);
  });

  it("rejects a partial prior record instead of claiming a successful save", async () => {
    await db.wardrobeItems.put(personalItem);
    await expect(savePersonalWardrobeItem(personalItem, imageSet)).rejects.toThrow("PARTIAL_WARDROBE_RECORD");
    expect(await db.itemImages.get(personalItem.id)).toBeUndefined();
  });

  it("prunes stale processing jobs without touching recent work", async () => {
    await db.processingJobs.bulkPut([{ id: "old", status: "failed", createdAt: 1 }, { id: "new", status: "processing", createdAt: 100 }]);
    await expect(pruneProcessingJobs(110, 20)).resolves.toBe(1);
    expect((await db.processingJobs.toArray()).map((job) => job.id)).toEqual(["new"]);
  });
});
