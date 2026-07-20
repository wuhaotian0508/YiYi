import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { PreferenceProfileSchema } from "@/domain/schemas";
import { buildCalibrationPreferenceProfile, createCalibrationResponse } from "@/domain/preferences/calibration-engine";
import { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";
import { YiYiDatabase } from "@/lib/storage/db";
import { demoPreferenceProfile } from "@/mocks/wardrobe";

const databaseNames: string[] = [];

function uniqueDatabaseName(label: string) {
  const name = `yiyi-migration-${label}-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

async function writeLegacyProfile(name: string, version: 1 | 5, profile: object) {
  const legacy = new Dexie(name);
  legacy.version(version).stores({
    wardrobeItems: "&id, category, availability, lastWornAt, createdAt",
    itemImages: "&itemId",
    preferenceProfiles: "&id",
    dailySessions: "&id, dateKey, status",
    outfitVersions: "&id, sessionId, parentVersionId, createdAt",
    appSettings: "&key",
    processingJobs: "&id, status, createdAt",
  });
  await legacy.open();
  await legacy.table("preferenceProfiles").put(profile);
  legacy.close();
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe("preference profile IndexedDB migration", () => {
  it("does not activate provenance-free legacy preferences during a real v1-to-current upgrade", async () => {
    const name = uniqueDatabaseName("unknown");
    await writeLegacyProfile(name, 1, {
      id: "default",
      wardrobeDirection: "mixed",
      styleVector: {
        relaxedPolished: 0.8,
        minimalExpressive: -0.7,
        softCool: 0.4,
        fittedOversized: 0.2,
        classicTrendAware: -0.3,
        feminineNeutral: 0.1,
      },
      styleFeedback: [{ lookId: "look-1", sentiment: "dislike" }],
      hardAvoids: [{ key: "color", value: "brown", strength: "hard", polarity: "avoid" }],
      softPreferences: [{ key: "style", value: "minimal", strength: "soft", polarity: "prefer" }],
      preferenceNotes: { moreOf: ["clean lines"], lessOf: ["bright color"], freeform: "I used to say this." },
      preferredMetals: ["silver"],
      comfortWeight: 0.8,
      formalityBias: -0.2,
      evidence: [],
      updatedAt: 1_700_000_000_000,
    });

    const upgraded = new YiYiDatabase(name);
    await upgraded.open();
    const profile = await upgraded.preferenceProfiles.get("default");

    expect(profile).toMatchObject({
      schemaVersion: 2,
      origin: "migrated",
      provenance: "personal",
      styleVector: {
        relaxedPolished: 0,
        minimalExpressive: 0,
        softCool: 0,
        fittedOversized: 0,
        classicTrendAware: 0,
        feminineNeutral: 0,
      },
      hardAvoids: [],
      softPreferences: [],
      preferenceNotes: { moreOf: [], lessOf: [], freeform: "" },
    });
    expect(profile?.preferenceSignals).not.toHaveLength(0);
    expect(profile?.preferenceSignals?.every((signal) => signal.status === "needs_review" && signal.confidence === 0)).toBe(true);
    expect(profile?.preferenceSignals?.find((signal) => signal.label === "bright color")?.polarity).toBe("less");
    expect(profile?.preferenceSignals?.find((signal) => signal.label === "I used to say this.")?.polarity).toBe("unknown");
    expect(() => PreferenceProfileSchema.parse(profile)).not.toThrow();
    upgraded.close();
  });

  it("recognizes the legacy canned demo fingerprint instead of relabeling it personal", async () => {
    const name = uniqueDatabaseName("demo");
    const legacyDemo = { ...demoPreferenceProfile } as Partial<typeof demoPreferenceProfile>;
    Reflect.deleteProperty(legacyDemo, "provenance");
    await writeLegacyProfile(name, 1, legacyDemo);

    const upgraded = new YiYiDatabase(name);
    await upgraded.open();
    const profile = await upgraded.preferenceProfiles.get("default");
    expect(profile).toMatchObject({ schemaVersion: 2, origin: "demo", provenance: "demo" });
    expect(() => PreferenceProfileSchema.parse(profile)).not.toThrow();
    upgraded.close();
  });

  it("preserves a provenance-bearing v2 calibration profile during the v5-to-v6 upgrade", async () => {
    const name = uniqueDatabaseName("canonical");
    const question = calibrationCatalogV2.questions[0];
    const canonical = buildCalibrationPreferenceProfile({
      direction: "neutral",
      responses: [createCalibrationResponse(question.id, "a", 1_750_000_000_000)],
      moreOf: ["An unstructured old note"],
      now: 1_750_000_000_100,
    });
    const storedBeforeDefaults = {
      ...canonical,
      preferenceSignals: canonical.preferenceSignals?.map((entry) => {
        const signal = { ...entry } as Partial<typeof entry>;
        Reflect.deleteProperty(signal, "status");
        Reflect.deleteProperty(signal, "categories");
        Reflect.deleteProperty(signal, "slots");
        Reflect.deleteProperty(signal, "combinationValues");
        return signal;
      }),
    };
    await writeLegacyProfile(name, 5, storedBeforeDefaults);

    const upgraded = new YiYiDatabase(name);
    await upgraded.open();
    const firstRead = await upgraded.preferenceProfiles.get("default");
    expect(firstRead?.preferenceSignals?.find((signal) => signal.attribute === "style_look")).toMatchObject({ status: "active", categories: [], slots: [], combinationValues: [] });
    expect(firstRead?.preferenceSignals?.find((signal) => signal.attribute === "preference_note")).toMatchObject({ status: "needs_review", categories: [], slots: [], combinationValues: [] });
    expect(firstRead?.styleVector).toEqual(canonical.styleVector);
    expect(firstRead).toMatchObject({ origin: "calibration", provenance: "personal" });
    upgraded.close();

    const reopened = new YiYiDatabase(name);
    await reopened.open();
    expect(await reopened.preferenceProfiles.get("default")).toEqual(firstRead);
    reopened.close();
  });
});
