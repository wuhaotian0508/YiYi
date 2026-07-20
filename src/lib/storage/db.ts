import Dexie, { type EntityTable } from "dexie";
import type { DailySession, ItemImageSet, OutfitVersion, PreferenceProfile, PreferenceSignal, WardrobeItem } from "@/domain/schemas";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { rebuildProfileFromSignals } from "@/domain/preferences/profile-mutations";

const obsoleteDemoItemId = "11111111-1111-4111-8111-111111111112";

export type AppSetting = { key: string; value: string | number | boolean };
export type ProcessingJob = { id: string; status: "waiting" | "processing" | "failed" | "complete"; createdAt: number };
export type ExperienceMode = "demo" | "personal";

const experienceModeKey = "experienceMode";
const demoWardrobeSeededKey = "demoWardrobeSeeded";
const demoItemIdsKey = "demoItemIds";

const cannedDemoRuleKeys = new Set([
  "category\u0000heels\u0000hard\u0000avoid",
  "style\u0000overly formal looks\u0000hard\u0000avoid",
  "style\u0000relaxed and clean\u0000soft\u0000prefer",
  "comfort\u0000comfortable shoes\u0000soft\u0000prefer",
  "style\u0000overly formal looks\u0000soft\u0000avoid",
]);

function ruleIdentity(rule: PreferenceProfile["softPreferences"][number]) {
  const polarity = rule.polarity ?? (rule.strength === "hard" ? "avoid" : "prefer");
  return `${rule.key}\u0000${rule.value.toLowerCase()}\u0000${rule.strength}\u0000${polarity}`;
}

type DemoDetectProfile = Partial<Pick<PreferenceProfile, "provenance" | "styleAnchors" | "evidence" | "styleVector">>;

export function isCannedDemoProfile(profile: DemoDetectProfile | undefined) {
  if (!profile) return false;
  if (profile.provenance === "demo") return true;
  const anchors = Array.isArray(profile.styleAnchors) ? profile.styleAnchors : [];
  const evidence = Array.isArray(profile.evidence) ? profile.evidence : [];
  const hasDemoAnchor = anchors.some((anchor) => anchor.id === "demo-relaxed-tailoring");
  const hasDemoEvidence = evidence.some((entry) => entry.phrase === "Comfort over formality")
    && evidence.some((entry) => entry.phrase === "Usually prefer silver-tone jewelry");
  const hasLegacyVector = profile.styleVector?.relaxedPolished === -0.25
    && profile.styleVector.minimalExpressive === -0.45
    && profile.styleVector.softCool === 0.2
    && profile.styleVector.fittedOversized === 0.25
    && profile.styleVector.classicTrendAware === -0.1
    && profile.styleVector.feminineNeutral === 0.35;
  return hasDemoAnchor || hasDemoEvidence || hasLegacyVector;
}

type MutableLegacyProfile = Record<string, unknown> & {
  id?: unknown;
  schemaVersion?: unknown;
  origin?: unknown;
  revision?: unknown;
  provenance?: unknown;
  updatedAt?: unknown;
  styleVector?: unknown;
  styleFeedback?: unknown;
  styleAnchors?: unknown;
  hardAvoids?: unknown;
  softPreferences?: unknown;
  preferenceNotes?: unknown;
  preferredMetals?: unknown;
  comfortWeight?: unknown;
  formalityBias?: unknown;
  evidence?: unknown;
  calibrationResponses?: unknown;
  preferenceSignals?: unknown;
  profileConfidence?: unknown;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedText(value: unknown, maximum = 80) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function stableMigrationId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const migratableAttributes = new Set<PreferenceSignal["attribute"]>([
  "style", "fit", "color", "material", "category", "subtype", "metal", "comfort", "formality", "preference_note",
]);

function migratedSignal(input: {
  attribute: PreferenceSignal["attribute"];
  value: string;
  label?: string;
  polarity: "more" | "less" | "unknown";
  strength?: "soft" | "hard";
  createdAt: number;
}): PreferenceSignal {
  const identity = `${input.attribute}\u0000${input.value.toLocaleLowerCase("en-US")}\u0000${input.polarity}`;
  return {
    id: `migration:${stableMigrationId(identity)}`,
    attribute: input.attribute,
    value: input.value.toLocaleLowerCase("en-US"),
    label: (input.label ?? input.value).slice(0, 80),
    polarity: input.polarity,
    strength: input.polarity === "less" && input.strength === "hard" ? "hard" : "soft",
    confidence: 0,
    scope: "global_style",
    categories: [],
    slots: [],
    permanence: "long_term",
    editable: true,
    status: "needs_review",
    combinationValues: [],
    styleTags: [],
    provenance: { source: "migration", sourceId: identity.slice(0, 160), createdAt: input.createdAt },
  };
}

function collectLegacySignals(profile: MutableLegacyProfile) {
  const createdAt = typeof profile.updatedAt === "number" ? profile.updatedAt : Date.now();
  const signals = new Map<string, PreferenceSignal>();
  const add = (signal: PreferenceSignal) => signals.set(signal.id, signal);

  for (const rawRule of [
    ...(Array.isArray(profile.hardAvoids) ? profile.hardAvoids : []),
    ...(Array.isArray(profile.softPreferences) ? profile.softPreferences : []),
  ]) {
    const rule = recordValue(rawRule);
    if (!rule) continue;
    const value = boundedText(rule.value);
    if (!value) continue;
    const key = boundedText(rule.key, 40).toLocaleLowerCase("en-US");
    const attribute = migratableAttributes.has(key as PreferenceSignal["attribute"])
      ? key as PreferenceSignal["attribute"]
      : "preference_note";
    const polarity = rule.polarity === "avoid" || rule.strength === "hard" ? "less" : "more";
    add(migratedSignal({ attribute, value, polarity, strength: rule.strength === "hard" ? "hard" : "soft", createdAt }));
  }

  const notes = recordValue(profile.preferenceNotes);
  for (const [field, polarity] of [["moreOf", "more"], ["lessOf", "less"]] as const) {
    const values = notes && Array.isArray(notes[field]) ? notes[field] : [];
    for (const rawValue of values) {
      const value = boundedText(rawValue);
      if (value) add(migratedSignal({ attribute: "preference_note", value, polarity, createdAt }));
    }
  }
  const freeform = boundedText(notes?.freeform, 80);
  if (freeform) add(migratedSignal({ attribute: "preference_note", value: freeform, polarity: "unknown", createdAt }));
  for (const rawMetal of Array.isArray(profile.preferredMetals) ? profile.preferredMetals : []) {
    const metal = boundedText(rawMetal);
    if (metal) add(migratedSignal({ attribute: "metal", value: metal, label: `${metal} metal`, polarity: "more", createdAt }));
  }
  return [...signals.values()];
}

function normalizeStoredSignal(rawSignal: unknown, updatedAt: number) {
  const signal = recordValue(rawSignal);
  if (!signal) return null;
  const attribute = boundedText(signal.attribute) as PreferenceSignal["attribute"];
  const provenance = recordValue(signal.provenance);
  return {
    ...signal,
    categories: Array.isArray(signal.categories) ? signal.categories : [],
    slots: Array.isArray(signal.slots) ? signal.slots : [],
    combinationValues: Array.isArray(signal.combinationValues) ? signal.combinationValues : [],
    styleTags: Array.isArray(signal.styleTags) ? signal.styleTags : [],
    permanence: typeof signal.permanence === "string" ? signal.permanence : "long_term",
    editable: typeof signal.editable === "boolean" ? signal.editable : true,
    status: attribute === "preference_note"
      ? "needs_review"
      : typeof signal.status === "string" ? signal.status : "active",
    confidence: attribute === "preference_note" && typeof signal.confidence !== "number" ? 0 : signal.confidence,
    provenance: provenance ?? { source: "migration", createdAt: updatedAt },
  };
}

/**
 * Legacy profiles did not preserve enough provenance to distinguish a user
 * statement from an inferred/default value. The v6 upgrade retains those
 * values as editable review records, but deliberately removes them from every
 * field consumed by recommendation until the user confirms them.
 */
export function migratePreferenceProfileV6(profile: MutableLegacyProfile) {
  const demoProfile = isCannedDemoProfile(profile as DemoDetectProfile);
  profile.schemaVersion = 2;
  profile.revision = typeof profile.revision === "number" ? profile.revision : 0;
  profile.calibrationResponses = Array.isArray(profile.calibrationResponses) ? profile.calibrationResponses : [];

  if (demoProfile) {
    profile.origin = "demo";
    profile.provenance = "demo";
    profile.preferenceSignals = Array.isArray(profile.preferenceSignals) ? profile.preferenceSignals : [];
    profile.profileConfidence = recordValue(profile.profileConfidence) ?? { evidence: 0, coverage: 0, differentiation: 0, overall: 0 };
    return;
  }

  if (Array.isArray(profile.preferenceSignals)) {
    profile.origin = typeof profile.origin === "string" ? profile.origin : "edited";
    profile.provenance = "personal";
    const updatedAt = typeof profile.updatedAt === "number" ? profile.updatedAt : Date.now();
    profile.preferenceSignals = profile.preferenceSignals
      .map((signal) => normalizeStoredSignal(signal, updatedAt))
      .filter((signal) => signal !== null);
    return;
  }

  profile.origin = "migrated";
  profile.provenance = "personal";
  profile.preferenceSignals = collectLegacySignals(profile);
  profile.profileConfidence = { evidence: 0, coverage: 0, differentiation: 0, overall: 0 };
  profile.styleVector = { relaxedPolished: 0, minimalExpressive: 0, softCool: 0, fittedOversized: 0, classicTrendAware: 0, feminineNeutral: 0 };
  profile.styleFeedback = [];
  profile.styleAnchors = [];
  profile.hardAvoids = [];
  profile.softPreferences = [];
  profile.preferenceNotes = { moreOf: [], lessOf: [], freeform: "" };
  profile.preferredMetals = [];
  profile.comfortWeight = 0.5;
  profile.formalityBias = 0;
  profile.evidence = [];
}

function materializePersonalProfile(profile: PreferenceProfile) {
  const neutral = createNeutralPreferenceProfile(profile.updatedAt);
  const explicitCanonicalSignals = (profile.preferenceSignals ?? []).filter((signal) => ["explicit_voice", "explicit_edit", "profile_edit"].includes(signal.provenance.source));
  if (explicitCanonicalSignals.length > 0) {
    return rebuildProfileFromSignals({
      profile: { ...neutral, wardrobeDirection: profile.wardrobeDirection },
      signals: explicitCanonicalSignals,
      now: profile.updatedAt,
    });
  }
  const explicitRules = [...profile.hardAvoids, ...profile.softPreferences]
    .filter((rule) => !cannedDemoRuleKeys.has(ruleIdentity(rule)));
  const explicitMetals = profile.preferredMetals.filter((metal) => metal !== "silver");
  const changedFreeform = profile.preferenceNotes.freeform && profile.preferenceNotes.freeform !== "Comfortable enough for walking."
    ? profile.preferenceNotes.freeform
    : "";
  const changedDirection = profile.wardrobeDirection !== "mixed" ? profile.wardrobeDirection : neutral.wardrobeDirection;
  const hasExplicitPersonalSignal = explicitRules.length > 0 || explicitMetals.length > 0 || Boolean(changedFreeform) || changedDirection !== neutral.wardrobeDirection;
  if (!hasExplicitPersonalSignal) return null;
  return {
    ...neutral,
    wardrobeDirection: changedDirection,
    hardAvoids: explicitRules.filter((rule) => rule.strength === "hard"),
    softPreferences: explicitRules.filter((rule) => rule.strength === "soft"),
    preferredMetals: explicitMetals,
    preferenceNotes: { moreOf: [], lessOf: [], freeform: changedFreeform },
    provenance: "personal" as const,
    updatedAt: profile.updatedAt,
  };
}

export class YiYiDatabase extends Dexie {
  wardrobeItems!: EntityTable<WardrobeItem, "id">;
  itemImages!: EntityTable<ItemImageSet, "itemId">;
  preferenceProfiles!: EntityTable<PreferenceProfile, "id">;
  dailySessions!: EntityTable<DailySession, "id">;
  outfitVersions!: EntityTable<OutfitVersion, "id">;
  appSettings!: EntityTable<AppSetting, "key">;
  processingJobs!: EntityTable<ProcessingJob, "id">;

  constructor(databaseName = "yiyi") {
    super(databaseName);
    this.version(1).stores({
      wardrobeItems: "&id, category, availability, lastWornAt, createdAt",
      itemImages: "&itemId",
      preferenceProfiles: "&id",
      dailySessions: "&id, dateKey, status",
      outfitVersions: "&id, sessionId, parentVersionId, createdAt",
      appSettings: "&key",
      processingJobs: "&id, status, createdAt",
    });
    this.version(2).stores({
      wardrobeItems: "&id, category, availability, lastWornAt, createdAt",
      itemImages: "&itemId",
      preferenceProfiles: "&id",
      dailySessions: "&id, dateKey, status",
      outfitVersions: "&id, sessionId, parentVersionId, createdAt",
      appSettings: "&key",
      processingJobs: "&id, status, createdAt",
    }).upgrade(async (transaction) => {
      await transaction.table("preferenceProfiles").toCollection().modify((profile) => {
        profile.wardrobeDirection ??= "neutral";
        profile.styleFeedback ??= [];
        profile.preferenceNotes ??= { moreOf: [], lessOf: [], freeform: "" };
      });
      await transaction.table("dailySessions").toCollection().modify((session) => {
        session.alternativeIds ??= [];
      });
    });
    this.version(3).stores({
      wardrobeItems: "&id, category, availability, lastWornAt, createdAt",
      itemImages: "&itemId",
      preferenceProfiles: "&id",
      dailySessions: "&id, dateKey, status",
      outfitVersions: "&id, sessionId, parentVersionId, createdAt",
      appSettings: "&key",
      processingJobs: "&id, status, createdAt",
    }).upgrade(async (transaction) => {
      await transaction.table("dailySessions").toCollection().modify((session) => {
        session.historyVersionIds ??= [];
      });
    });
    this.version(4).stores({
      wardrobeItems: "&id, category, availability, lastWornAt, createdAt",
      itemImages: "&itemId",
      preferenceProfiles: "&id",
      dailySessions: "&id, dateKey, status",
      outfitVersions: "&id, sessionId, parentVersionId, createdAt",
      appSettings: "&key",
      processingJobs: "&id, status, createdAt",
    }).upgrade(async (transaction) => {
      await transaction.table("preferenceProfiles").toCollection().modify((profile) => {
        profile.styleAnchors ??= [];
        profile.provenance ??= "personal";
      });
      await transaction.table("dailySessions").toCollection().modify((session) => {
        session.shownOutfitIds ??= session.mainRecommendationId ? [session.mainRecommendationId] : [];
        session.operationGeneration ??= 0;
      });
    });
    this.version(5).stores({
      wardrobeItems: "&id, category, availability, lastWornAt, createdAt",
      itemImages: "&itemId",
      preferenceProfiles: "&id",
      dailySessions: "&id, dateKey, status",
      outfitVersions: "&id, sessionId, parentVersionId, createdAt",
      appSettings: "&key",
      processingJobs: "&id, status, createdAt",
    }).upgrade(async (transaction) => {
      await transaction.table("preferenceProfiles").toCollection().modify((profile) => {
        const rules = [...(profile.hardAvoids ?? []), ...(profile.softPreferences ?? [])] as Array<{ strength?: string; polarity?: string }>;
        for (const rule of rules) if (rule.strength === "hard" && rule.polarity === "prefer") rule.strength = "soft";
      });
    });
    this.version(6).stores({
      wardrobeItems: "&id, category, availability, lastWornAt, createdAt",
      itemImages: "&itemId",
      preferenceProfiles: "&id",
      dailySessions: "&id, dateKey, status",
      outfitVersions: "&id, sessionId, parentVersionId, createdAt",
      appSettings: "&key",
      processingJobs: "&id, status, createdAt",
    }).upgrade(async (transaction) => {
      await transaction.table("preferenceProfiles").toCollection().modify((profile) => {
        migratePreferenceProfileV6(profile as MutableLegacyProfile);
      });
    });
  }
}

export const db = new YiYiDatabase();

export function shouldSeedDemoWardrobe(input: { mode: ExperienceMode | null; alreadySeeded: boolean; itemCount: number; environmentEnabled: boolean }) {
  return input.mode !== "personal" && !input.alreadySeeded && input.itemCount === 0 && input.environmentEnabled;
}

export async function setExperienceMode(mode: ExperienceMode, resetDemoSeed = false) {
  await db.transaction("rw", [db.appSettings, db.wardrobeItems, db.itemImages, db.preferenceProfiles, db.dailySessions, db.outfitVersions], async () => {
    await db.appSettings.put({ key: experienceModeKey, value: mode });
    if (mode === "personal") {
      const storedIds = (await db.appSettings.get(demoItemIdsKey))?.value;
      let parsedIds: unknown = [];
      if (typeof storedIds === "string") {
        try { parsedIds = JSON.parse(storedIds) as unknown; } catch { parsedIds = []; }
      }
      const demoIds = Array.isArray(parsedIds) ? parsedIds.filter((value): value is string => typeof value === "string") : [];
      const taggedDemoIds = (await db.wardrobeItems.filter((item) => item.dataProvenance === "demo").toArray()).map((item) => item.id);
      const ids = [...new Set([...demoIds, ...taggedDemoIds])];
      if (ids.length) {
        await db.wardrobeItems.bulkDelete(ids);
        await db.itemImages.bulkDelete(ids);
      }
      const profile = await db.preferenceProfiles.get("default");
      if (isCannedDemoProfile(profile)) {
        const personalProfile = profile ? materializePersonalProfile(profile) : null;
        if (personalProfile) await db.preferenceProfiles.put(personalProfile);
        else await db.preferenceProfiles.delete("default");
      }
      await db.dailySessions.clear();
      await db.outfitVersions.clear();
      await db.appSettings.put({ key: demoWardrobeSeededKey, value: true });
    }
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
    const demoItems = items.map((item) => ({ ...item, dataProvenance: "demo" as const, featureProvenance: { ...item.featureProvenance, source: "demo" as const } }));
    await db.wardrobeItems.bulkPut(demoItems);
    await db.appSettings.put({ key: experienceModeKey, value: "demo" });
    await db.appSettings.put({ key: demoWardrobeSeededKey, value: true });
    await db.appSettings.put({ key: demoItemIdsKey, value: JSON.stringify(demoItems.map((item) => item.id)) });
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

const soundEnabledKey = "soundEnabled";

export async function getSoundEnabled() {
  const value = (await db.appSettings.get(soundEnabledKey))?.value;
  return value === undefined ? true : value === true;
}

export async function setSoundEnabled(enabled: boolean) {
  await db.appSettings.put({ key: soundEnabledKey, value: enabled });
}

/** Deletes YiYi's IndexedDB records and only YiYi-owned web storage keys. */
export async function resetAllLocalAppData() {
  await db.delete();
  if (typeof window === "undefined") return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    const ownedKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith("yiyi:")) ownedKeys.push(key);
    }
    for (const key of ownedKeys) storage.removeItem(key);
  }
}
