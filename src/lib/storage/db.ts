import Dexie, { type EntityTable } from "dexie";
import type { DailySession, ItemImageSet, OutfitVersion, PreferenceProfile, WardrobeItem } from "@/domain/schemas";

const obsoleteDemoItemId = "11111111-1111-4111-8111-111111111112";

export type AppSetting = { key: string; value: string | number | boolean };
export type ProcessingJob = { id: string; status: "waiting" | "processing" | "failed" | "complete"; createdAt: number };
export type ExperienceMode = "demo" | "personal";

const experienceModeKey = "experienceMode";
const demoWardrobeSeededKey = "demoWardrobeSeeded";

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

export function shouldSeedDemoWardrobe(input: { mode: ExperienceMode | null; alreadySeeded: boolean; itemCount: number; environmentEnabled: boolean }) {
  return input.mode !== "personal" && !input.alreadySeeded && input.itemCount === 0 && input.environmentEnabled;
}

export async function setExperienceMode(mode: ExperienceMode, resetDemoSeed = false) {
  await db.transaction("rw", db.appSettings, async () => {
    await db.appSettings.put({ key: experienceModeKey, value: mode });
    if (mode === "personal") await db.appSettings.put({ key: demoWardrobeSeededKey, value: true });
    else if (resetDemoSeed) await db.appSettings.put({ key: demoWardrobeSeededKey, value: false });
  });
}

export async function getExperienceMode(): Promise<ExperienceMode | null> {
  const value = (await db.appSettings.get(experienceModeKey))?.value;
  return value === "demo" || value === "personal" ? value : null;
}

export async function seedWardrobe(items: WardrobeItem[], options: { explicit?: boolean } = {}) {
  await db.transaction("rw", db.wardrobeItems, db.itemImages, db.appSettings, async () => {
    await db.wardrobeItems.delete(obsoleteDemoItemId);
    await db.itemImages.delete(obsoleteDemoItemId);
    const itemCount = await db.wardrobeItems.count();
    const modeValue = (await db.appSettings.get(experienceModeKey))?.value;
    const mode = modeValue === "demo" || modeValue === "personal" ? modeValue : null;
    const alreadySeeded = (await db.appSettings.get(demoWardrobeSeededKey))?.value === true;
    const environmentEnabled = options.explicit === true || process.env.NEXT_PUBLIC_SEED_DEMO_WARDROBE !== "false";
    if (itemCount > 0 && !mode) {
      await db.appSettings.put({ key: experienceModeKey, value: "personal" });
      await db.appSettings.put({ key: demoWardrobeSeededKey, value: true });
      return;
    }
    if (!shouldSeedDemoWardrobe({ mode, alreadySeeded, itemCount, environmentEnabled })) return;
    await db.wardrobeItems.bulkPut(items);
    await db.appSettings.put({ key: experienceModeKey, value: "demo" });
    await db.appSettings.put({ key: demoWardrobeSeededKey, value: true });
  });
}

export async function seedPreferences(profile: PreferenceProfile) {
  if (!(await db.preferenceProfiles.get(profile.id))) await db.preferenceProfiles.put(profile);
}

export async function savePreferences(profile: PreferenceProfile) {
  await db.preferenceProfiles.put(profile);
}

export async function requestPersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage) return { persisted: false, usage: 0, quota: 0 };
  const persisted = (await navigator.storage.persist?.()) ?? false;
  const estimate = await navigator.storage.estimate();
  return { persisted, usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}
