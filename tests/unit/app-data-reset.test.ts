// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, resetAllLocalAppData } from "@/lib/storage/db";
import { demoWardrobe } from "@/mocks/wardrobe";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

describe("local privacy reset", () => {
  beforeEach(async () => {
    Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: memoryStorage() });
    await db.delete();
    await db.open();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(async () => {
    await db.delete();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("removes every YiYi table including image blobs and only YiYi-owned storage keys", async () => {
    const item = demoWardrobe[0];
    const now = Date.now();
    await db.wardrobeItems.put(item);
    await db.itemImages.put({ itemId: item.id, cutoutBlob: new Blob(["private-image"]), thumbnailBlob: new Blob(["private-thumbnail"]), width: 1, height: 1, createdAt: now, updatedAt: now });
    await db.appSettings.put({ key: "soundEnabled", value: false });
    await db.processingJobs.put({ id: "job", status: "failed", createdAt: now });
    window.localStorage.setItem("yiyi:onboarding-complete", "true");
    window.sessionStorage.setItem("yiyi:pending", "private");
    window.localStorage.setItem("unrelated", "keep");

    await resetAllLocalAppData();
    await db.open();

    await expect(Promise.all(db.tables.map((table) => table.count()))).resolves.toEqual(db.tables.map(() => 0));
    expect(window.localStorage.getItem("yiyi:onboarding-complete")).toBeNull();
    expect(window.sessionStorage.getItem("yiyi:pending")).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });
});
