// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { completeOnboarding, db, getOnboardingState, migrateLegacyOnboardingState, seedWardrobe, shouldSeedDemoWardrobe } from "@/lib/storage/db";
import { demoWardrobe } from "@/mocks/wardrobe";

describe("canonical onboarding and explicit demo boundaries", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
  });

  it("never treats an environment flag as explicit user consent to seed Demo", () => {
    expect(shouldSeedDemoWardrobe({
      mode: null,
      alreadySeeded: false,
      itemCount: 0,
      environmentEnabled: true,
    })).toBe(false);
  });

  it("does not resurrect Demo after the explicitly seeded wardrobe is deleted", async () => {
    await seedWardrobe(demoWardrobe, { explicit: true });
    expect(await db.wardrobeItems.count()).toBe(demoWardrobe.length);
    await db.wardrobeItems.clear();

    await seedWardrobe(demoWardrobe);

    expect(await db.wardrobeItems.count()).toBe(0);
  });

  it("migrates a legacy completed personal device without changing its clothes", async () => {
    const item = { ...demoWardrobe[0], id: "99999999-9999-4999-8999-999999999999", dataProvenance: "personal" as const };
    await db.wardrobeItems.put(item);
    const values = new Map([["yiyi:onboarding-complete", "true"]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };

    const state = await migrateLegacyOnboardingState(storage);

    expect(state).toMatchObject({ status: "complete", version: 1, experienceMode: "personal" });
    expect(await db.wardrobeItems.toArray()).toEqual([item]);
    expect(values.has("yiyi:onboarding-complete")).toBe(false);
  });

  it("commits profile, explicit Demo selection, mode, and completion together", async () => {
    const profile = createNeutralPreferenceProfile(1);
    const state = await completeOnboarding({ mode: "demo", profile, demoItems: demoWardrobe });

    expect(state).toMatchObject({ status: "complete", version: 1, experienceMode: "demo" });
    expect(await getOnboardingState()).toEqual(state);
    expect(await db.preferenceProfiles.get("default")).toEqual(profile);
    expect(await db.wardrobeItems.count()).toBe(demoWardrobe.length);
  });

  it("keeps personal onboarding empty and never seeds Demo implicitly", async () => {
    const state = await completeOnboarding({ mode: "personal", profile: createNeutralPreferenceProfile(1), demoItems: demoWardrobe });
    expect(state.experienceMode).toBe("personal");
    expect(await db.wardrobeItems.count()).toBe(0);
    await seedWardrobe(demoWardrobe);
    expect(await db.wardrobeItems.count()).toBe(0);
  });
});
