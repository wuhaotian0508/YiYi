import Dexie, { type EntityTable } from "dexie";
import { ItemImageSetSchema, WardrobeItemSchema, type DailySession, type ItemImageSet, type OutfitVersion, type PreferenceProfile, type PreferenceSignal, type WardrobeItem } from "@/domain/schemas";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { rebuildProfileFromSignals } from "@/domain/preferences/profile-mutations";

const obsoleteDemoItemId = "11111111-1111-4111-8111-111111111112";

export type AppSetting = { key: string; value: string | number | boolean };
export type ProcessingJob = { id: string; status: "waiting" | "processing" | "failed" | "complete"; createdAt: number };
type StoredImageBinary = { mime: string; bytes: ArrayBuffer };
type StoredItemImageSet = Omit<ItemImageSet, "originalBlob" | "cutoutBlob" | "thumbnailBlob" | "cutoutMaskBlob"> & {
  originalBlob?: Blob | StoredImageBinary;
  cutoutBlob: Blob | StoredImageBinary;
  thumbnailBlob: Blob | StoredImageBinary;
  cutoutMaskBlob?: Blob | StoredImageBinary;
};
export type ExperienceMode = "demo" | "personal";
export type OnboardingState = {
  status: "incomplete" | "complete";
  version: 1;
  completedAt: number | null;
  experienceMode: ExperienceMode | null;
};

const experienceModeKey = "experienceMode";
const demoWardrobeSeededKey = "demoWardrobeSeeded";
const demoItemIdsKey = "demoItemIds";
const onboardingStateKey = "onboardingState";
const personalCleanupPendingKey = "personalCleanupPending";
const legacyOnboardingStorageKey = "yiyi:onboarding-complete";
const incompleteOnboardingState: OnboardingState = { status: "incomplete", version: 1, completedAt: null, experienceMode: null };

// Cloud failures never affect the successful local Dexie write that triggered them.
function scheduleCloudSync() {
  void import("@/lib/cloud/sync").then(({ queueCloudSync }) => queueCloudSync()).catch(() => undefined);
}

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
  itemImages!: EntityTable<StoredItemImageSet, "itemId">;
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
    this.version(7).stores({
      wardrobeItems: "&id, category, availability, lastWornAt, createdAt",
      itemImages: "&itemId",
      preferenceProfiles: "&id",
      dailySessions: "&id, dateKey, status",
      outfitVersions: "&id, sessionId, parentVersionId, createdAt",
      appSettings: "&key",
      processingJobs: "&id, status, createdAt",
    });
    this.version(8).stores({
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

export function shouldSeedDemoWardrobe(input: { mode: ExperienceMode | null; alreadySeeded: boolean; itemCount: number; environmentEnabled?: boolean; explicit?: boolean }) {
  return input.explicit === true && input.mode !== "personal" && !input.alreadySeeded && input.itemCount === 0;
}

function parseOnboardingState(value: unknown): OnboardingState | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<OnboardingState>;
    if (candidate.version !== 1 || (candidate.status !== "complete" && candidate.status !== "incomplete")) return null;
    if (candidate.experienceMode !== null && candidate.experienceMode !== "demo" && candidate.experienceMode !== "personal") return null;
    if (candidate.completedAt !== null && typeof candidate.completedAt !== "number") return null;
    return candidate as OnboardingState;
  } catch {
    return null;
  }
}

async function writeOnboardingState(state: OnboardingState) {
  await db.appSettings.put({ key: onboardingStateKey, value: JSON.stringify(state) });
}

export async function getOnboardingState() {
  return parseOnboardingState((await db.appSettings.get(onboardingStateKey))?.value) ?? incompleteOnboardingState;
}

/**
 * localStorage was the legacy completion source. Migration is intentionally
 * runtime-only: IndexedDB upgrades cannot safely read browser web storage.
 * Existing wardrobe records are inspected but never removed or rewritten.
 */
export async function migrateLegacyOnboardingState(storage?: Pick<Storage, "getItem" | "removeItem">): Promise<OnboardingState> {
  const existing = parseOnboardingState((await db.appSettings.get(onboardingStateKey))?.value);
  const legacyStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (existing) {
    legacyStorage?.removeItem(legacyOnboardingStorageKey);
    return existing;
  }
  if (legacyStorage?.getItem(legacyOnboardingStorageKey) !== "true") return incompleteOnboardingState;

  const storedMode = await getExperienceMode();
  const items = await db.wardrobeItems.toArray();
  const hasPersonalItems = items.some((item) => item.dataProvenance !== "demo");
  const hasDemoItems = items.some((item) => item.dataProvenance === "demo");
  const mode: ExperienceMode = hasPersonalItems ? "personal" : storedMode ?? (hasDemoItems ? "demo" : "personal");
  const state: OnboardingState = { status: "complete", version: 1, completedAt: Date.now(), experienceMode: mode };
  await db.transaction("rw", db.appSettings, async () => {
    await db.appSettings.put({ key: experienceModeKey, value: mode });
    await writeOnboardingState(state);
  });
  legacyStorage.removeItem(legacyOnboardingStorageKey);
  return state;
}

export async function completeOnboarding(input: { mode: ExperienceMode; profile: PreferenceProfile; demoItems: WardrobeItem[] }) {
  const state = await db.transaction("rw", [db.appSettings, db.wardrobeItems, db.itemImages, db.preferenceProfiles, db.dailySessions, db.outfitVersions], async () => {
    const currentItems = await db.wardrobeItems.toArray();
    const personalItems = currentItems.filter((item) => item.dataProvenance !== "demo");
    const effectiveMode: ExperienceMode = input.mode === "demo" && personalItems.length > 0 ? "personal" : input.mode;

    if (effectiveMode === "personal") {
      const demoIds = currentItems.filter((item) => item.dataProvenance === "demo").map((item) => item.id);
      if (demoIds.length > 0) {
        await db.wardrobeItems.bulkDelete(demoIds);
        await db.itemImages.bulkDelete(demoIds);
        await db.dailySessions.clear();
        await db.outfitVersions.clear();
      }
      await db.appSettings.put({ key: demoWardrobeSeededKey, value: true });
    } else {
      const alreadySeeded = (await db.appSettings.get(demoWardrobeSeededKey))?.value === true;
      if (shouldSeedDemoWardrobe({ mode: "demo", alreadySeeded, itemCount: currentItems.length, explicit: true })) {
        const demoItems = input.demoItems.map((item) => ({ ...item, dataProvenance: "demo" as const, featureProvenance: { ...item.featureProvenance, source: "demo" as const } }));
        await db.wardrobeItems.bulkPut(demoItems);
        await db.appSettings.put({ key: demoItemIdsKey, value: JSON.stringify(demoItems.map((item) => item.id)) });
      }
      await db.appSettings.put({ key: demoWardrobeSeededKey, value: true });
    }

    const completedAt = Date.now();
    const state: OnboardingState = { status: "complete", version: 1, completedAt, experienceMode: effectiveMode };
    await db.appSettings.put({ key: experienceModeKey, value: effectiveMode });
    await db.preferenceProfiles.put(input.profile);
    await writeOnboardingState(state);
    return state;
  });
  scheduleCloudSync();
  return state;
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

function isStoredImageBinary(value: unknown): value is StoredImageBinary {
  return Boolean(value && typeof value === "object" && "mime" in value && typeof (value as { mime?: unknown }).mime === "string" && "bytes" in value && (value as { bytes?: unknown }).bytes instanceof ArrayBuffer);
}

async function encodeStoredImage(blob: Blob): Promise<StoredImageBinary> {
  return { mime: blob.type, bytes: await blob.arrayBuffer() };
}

function decodeStoredImage(value: Blob | StoredImageBinary | undefined) {
  if (!value) return undefined;
  if (value instanceof Blob) return value;
  if (!isStoredImageBinary(value)) throw new Error("WARDROBE_IMAGE_BINARY_INVALID");
  return new Blob([value.bytes], { type: value.mime });
}

export async function getItemImageSet(itemId: string) {
  const stored = await db.itemImages.get(itemId);
  if (!stored) return undefined;
  return ItemImageSetSchema.parse({
    ...stored,
    originalBlob: decodeStoredImage(stored.originalBlob),
    cutoutBlob: decodeStoredImage(stored.cutoutBlob),
    thumbnailBlob: decodeStoredImage(stored.thumbnailBlob),
    cutoutMaskBlob: decodeStoredImage(stored.cutoutMaskBlob),
  });
}

export async function verifyPersonalWardrobeItemSave(itemId: string) {
  const [storedItem, storedImages] = await Promise.all([db.wardrobeItems.get(itemId), getItemImageSet(itemId)]);
  const item = WardrobeItemSchema.safeParse(storedItem);
  const images = ItemImageSetSchema.safeParse(storedImages);
  if (!item.success) throw new Error("WARDROBE_ITEM_READBACK_FAILED");
  if (!images.success) throw new Error("WARDROBE_IMAGES_READBACK_FAILED");
  if (images.data.itemId !== itemId) throw new Error("WARDROBE_IMAGE_ID_READBACK_FAILED");
  if (images.data.cutoutBlob.size < 1 || images.data.thumbnailBlob.size < 1) throw new Error("WARDROBE_BLOB_READBACK_FAILED");
  return { item: item.data, images: images.data };
}

export async function finalizePersonalWardrobeMigration() {
  await db.transaction("rw", [db.appSettings, db.wardrobeItems, db.itemImages, db.preferenceProfiles, db.dailySessions, db.outfitVersions], async () => {
    const storedIds = (await db.appSettings.get(demoItemIdsKey))?.value;
    let parsedIds: unknown = [];
    if (typeof storedIds === "string") {
      try { parsedIds = JSON.parse(storedIds) as unknown; } catch { parsedIds = []; }
    }
    const recordedDemoIds = Array.isArray(parsedIds) ? parsedIds.filter((value): value is string => typeof value === "string") : [];
    const taggedDemoIds = (await db.wardrobeItems.filter((candidate) => candidate.dataProvenance === "demo").toArray()).map((candidate) => candidate.id);
    const demoIds = [...new Set([...recordedDemoIds, ...taggedDemoIds])];
    if (demoIds.length) {
      await db.wardrobeItems.bulkDelete(demoIds);
      await db.itemImages.bulkDelete(demoIds);
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
    await db.appSettings.delete(demoItemIdsKey);
    await db.appSettings.put({ key: personalCleanupPendingKey, value: false });
  });
  scheduleCloudSync();
}

/**
 * Commit the product-critical item and display images first. Optional original
 * storage and Demo cleanup are deliberately separate so Safari cannot abort a
 * first personal save because an unrelated store or a large archival Blob fails.
 */
export async function savePersonalWardrobeItem(item: WardrobeItem, images: ItemImageSet) {
  if (item.id !== images.itemId) throw new Error("WARDROBE_IMAGE_ITEM_MISMATCH");
  const requiredImages: StoredItemImageSet = {
    itemId: images.itemId,
    cutoutBlob: await encodeStoredImage(images.cutoutBlob),
    thumbnailBlob: await encodeStoredImage(images.thumbnailBlob),
    ...(images.cutoutMaskBlob ? { cutoutMaskBlob: await encodeStoredImage(images.cutoutMaskBlob) } : {}),
    width: images.width,
    height: images.height,
    createdAt: images.createdAt,
    updatedAt: images.updatedAt,
  };
  let alreadySaved = false;
  await db.transaction("rw", [db.appSettings, db.wardrobeItems, db.itemImages], async () => {
    const [existingItem, existingImages] = await Promise.all([db.wardrobeItems.get(item.id), db.itemImages.get(item.id)]);
    if (existingItem || existingImages) {
      if (existingItem && existingImages) {
        alreadySaved = true;
      } else {
        throw new Error("PARTIAL_WARDROBE_RECORD");
      }
    } else {
      await db.wardrobeItems.add(item);
      await db.itemImages.add(requiredImages);
    }
    await db.appSettings.put({ key: experienceModeKey, value: "personal" });
    await db.appSettings.put({ key: personalCleanupPendingKey, value: true });
    const onboarding = parseOnboardingState((await db.appSettings.get(onboardingStateKey))?.value);
    if (onboarding?.status === "complete" && onboarding.experienceMode !== "personal") {
      await writeOnboardingState({ ...onboarding, experienceMode: "personal" });
    }
  });

  await verifyPersonalWardrobeItemSave(item.id);

  let cleanupPending = false;
  try {
    await finalizePersonalWardrobeMigration();
  } catch {
    cleanupPending = true;
    await db.appSettings.put({ key: personalCleanupPendingKey, value: true }).catch(() => undefined);
  }

  let originalStored = Boolean((await db.itemImages.get(item.id))?.originalBlob);
  if (!originalStored && images.originalBlob?.size) {
    try {
      await db.itemImages.update(item.id, { originalBlob: await encodeStoredImage(images.originalBlob), updatedAt: images.updatedAt });
      originalStored = Boolean((await db.itemImages.get(item.id))?.originalBlob);
    } catch {
      originalStored = false;
    }
  }

  await verifyPersonalWardrobeItemSave(item.id);
  scheduleCloudSync();
  return { itemId: item.id, alreadySaved, originalStored, cleanupPending };
}

export async function pruneProcessingJobs(now = Date.now(), maximumAgeMs = 24 * 60 * 60 * 1_000) {
  const cutoff = now - maximumAgeMs;
  const expired = await db.processingJobs.where("createdAt").below(cutoff).primaryKeys();
  if (expired.length) await db.processingJobs.bulkDelete(expired);
  return expired.length;
}

export async function getExperienceMode(): Promise<ExperienceMode | null> {
  const value = (await db.appSettings.get(experienceModeKey))?.value;
  return value === "demo" || value === "personal" ? value : null;
}

export async function getWardrobeItemsForCurrentMode() {
  const [mode, pending] = await Promise.all([
    getExperienceMode(),
    db.appSettings.get(personalCleanupPendingKey),
  ]);
  if (mode === "personal" && pending?.value === true) {
    await finalizePersonalWardrobeMigration().catch(() => undefined);
  }
  const items = await db.wardrobeItems.toArray();
  return mode === "personal" ? items.filter((item) => item.dataProvenance !== "demo") : items;
}

export async function seedWardrobe(items: WardrobeItem[], options: { explicit?: boolean } = {}) {
  await db.transaction("rw", db.wardrobeItems, db.itemImages, db.appSettings, async () => {
    await db.wardrobeItems.delete(obsoleteDemoItemId);
    await db.itemImages.delete(obsoleteDemoItemId);
    const itemCount = await db.wardrobeItems.count();
    const modeValue = (await db.appSettings.get(experienceModeKey))?.value;
    const mode = modeValue === "demo" || modeValue === "personal" ? modeValue : null;
    const alreadySeeded = (await db.appSettings.get(demoWardrobeSeededKey))?.value === true;
    if (options.explicit !== true) return;
    if (itemCount > 0 && !mode) {
      await db.appSettings.put({ key: experienceModeKey, value: "personal" });
      await db.appSettings.put({ key: demoWardrobeSeededKey, value: true });
      return;
    }
    if (!shouldSeedDemoWardrobe({ mode, alreadySeeded, itemCount, explicit: true })) return;
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
  scheduleCloudSync();
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
