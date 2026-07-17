import Dexie, { type EntityTable } from "dexie";
import type { DailySession, ItemImageSet, OutfitVersion, PreferenceProfile, WardrobeItem } from "@/domain/schemas";

const obsoleteDemoItemId = "11111111-1111-4111-8111-111111111112";

export type AppSetting = { key: string; value: string | number | boolean };
export type ProcessingJob = { id: string; status: "waiting" | "processing" | "failed" | "complete"; createdAt: number };

export class YiYiDatabase extends Dexie {
  wardrobeItems!: EntityTable<WardrobeItem, "id">;
  itemImages!: EntityTable<ItemImageSet, "itemId">;
  preferenceProfiles!: EntityTable<PreferenceProfile, "id">;
  dailySessions!: EntityTable<DailySession, "id">;
  outfitVersions!: EntityTable<OutfitVersion, "id">;
  appSettings!: EntityTable<AppSetting, "key">;
  processingJobs!: EntityTable<ProcessingJob, "id">;

  constructor() {
    super("yiyi");
    this.version(1).stores({
      wardrobeItems: "&id, category, availability, lastWornAt, createdAt",
      itemImages: "&itemId",
      preferenceProfiles: "&id",
      dailySessions: "&id, dateKey, status",
      outfitVersions: "&id, sessionId, parentVersionId, createdAt",
      appSettings: "&key",
      processingJobs: "&id, status, createdAt",
    });
  }
}

export const db = new YiYiDatabase();

export async function seedWardrobe(items: WardrobeItem[]) {
  await db.transaction("rw", db.wardrobeItems, db.itemImages, async () => {
    await db.wardrobeItems.delete(obsoleteDemoItemId);
    await db.itemImages.delete(obsoleteDemoItemId);
    if ((await db.wardrobeItems.count()) === 0) await db.wardrobeItems.bulkPut(items);
  });
}

export async function seedPreferences(profile: PreferenceProfile) {
  if (!(await db.preferenceProfiles.get(profile.id))) await db.preferenceProfiles.put(profile);
}

export async function requestPersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage) return { persisted: false, usage: 0, quota: 0 };
  const persisted = (await navigator.storage.persist?.()) ?? false;
  const estimate = await navigator.storage.estimate();
  return { persisted, usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}
