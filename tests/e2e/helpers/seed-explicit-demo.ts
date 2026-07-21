import { expect, type Page } from "@playwright/test";
import { demoPreferenceProfile, demoWardrobe } from "../../../src/mocks/wardrobe";

export async function seedExplicitDemo(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  await page.evaluate(async ({ wardrobe, profile }) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, reject) => {
      const request = indexedDB.open("yiyi");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolveWrite, reject) => {
      const transaction = database.transaction(["appSettings", "wardrobeItems", "preferenceProfiles"], "readwrite");
      const settings = transaction.objectStore("appSettings");
      settings.put({ key: "experienceMode", value: "demo" });
      settings.put({ key: "demoWardrobeSeeded", value: true });
      settings.put({ key: "demoItemIds", value: JSON.stringify(wardrobe.map((item) => item.id)) });
      settings.put({ key: "onboardingState", value: JSON.stringify({ status: "complete", version: 1, completedAt: Date.now(), experienceMode: "demo" }) });
      const items = transaction.objectStore("wardrobeItems");
      for (const item of wardrobe) items.put(item);
      transaction.objectStore("preferenceProfiles").put(profile);
      transaction.oncomplete = () => resolveWrite();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { wardrobe: demoWardrobe, profile: demoPreferenceProfile });
}
