import { DailySessionSchema, OutfitVersionSchema, type DailyIntent, type DailySession, type Outfit, type PreferenceProfile, type WardrobeItem, type WeatherContext } from "@/domain/schemas";
import { createRecommendationContext, RecommendationError } from "@/domain/recommendation/context";
import { validateOutfit } from "@/domain/recommendation/constraints";
import { changedAndPreserved } from "@/domain/recommendation/engine";
import { db } from "@/lib/storage/db";

function stale(message = "A newer outfit operation already changed this session."): never {
  throw new RecommendationError("STALE_OPERATION", message);
}

export async function commitOutfitMutation(input: {
  sessionId: string;
  dateKey: string;
  intent: DailyIntent;
  weather: WeatherContext | null;
  outfit: Outfit;
  baseVersionId: string | null;
  expectedGeneration: number;
  revisionRequest: string | null;
}): Promise<{ versionId: string; session: DailySession }> {
  return db.transaction("rw", db.outfitVersions, db.dailySessions, async () => {
    const existing = await db.dailySessions.get(input.sessionId);
    if (!existing && (input.baseVersionId !== null || input.expectedGeneration !== 0)) stale("A new session must start from generation zero.");
    if (existing && existing.currentVersionId !== input.baseVersionId) stale();
    if (existing && existing.operationGeneration !== input.expectedGeneration) stale();
    const baseVersion = input.baseVersionId ? await db.outfitVersions.get(input.baseVersionId) : null;
    if (input.baseVersionId && (!baseVersion || baseVersion.sessionId !== input.sessionId)) {
      throw new RecommendationError("PERSISTENCE_FAILED", "The base outfit version is missing or belongs to another session.");
    }
    const now = Date.now();
    const changes = baseVersion ? changedAndPreserved(baseVersion.outfit, input.outfit) : {
      changedItemIds: [],
      preservedItemIds: Object.values(input.outfit.itemIds).filter((id): id is string => Boolean(id)),
    };
    const version = OutfitVersionSchema.parse({
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      parentVersionId: input.baseVersionId,
      outfit: input.outfit,
      revisionRequest: input.revisionRequest,
      changedItemIds: changes.changedItemIds,
      preservedItemIds: changes.preservedItemIds,
      createdAt: now,
    });
    const historyVersionIds = input.baseVersionId
      ? [...(existing?.historyVersionIds ?? []), input.baseVersionId].slice(-50)
      : [];
    const shownOutfitIds = [...new Set([...(existing?.shownOutfitIds ?? []), input.outfit.id])].slice(-100);
    const session = DailySessionSchema.parse({
      id: input.sessionId,
      dateKey: input.dateKey,
      status: "active",
      intent: input.intent,
      weather: input.weather,
      currentVersionId: version.id,
      mainRecommendationId: input.outfit.id,
      alternativeIds: [],
      historyVersionIds,
      shownOutfitIds,
      operationGeneration: input.expectedGeneration + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      confirmedAt: null,
    });
    await db.outfitVersions.put(version);
    await db.dailySessions.put(session);
    return { versionId: version.id, session };
  });
}

export async function undoOutfitMutation(input: { sessionId: string; baseVersionId: string; expectedGeneration: number; wardrobe: WardrobeItem[]; profile: PreferenceProfile; weather: WeatherContext | null }) {
  return db.transaction("rw", db.outfitVersions, db.dailySessions, async () => {
    const session = await db.dailySessions.get(input.sessionId);
    if (!session || session.currentVersionId !== input.baseVersionId || session.operationGeneration !== input.expectedGeneration) stale();
    const previousVersionId = session.historyVersionIds.at(-1);
    if (!previousVersionId) return null;
    const previous = await db.outfitVersions.get(previousVersionId);
    if (!previous) throw new RecommendationError("PERSISTENCE_FAILED", "The previous outfit version is missing.");
    const context = createRecommendationContext({ wardrobe: input.wardrobe, intent: session.intent, profile: input.profile, weather: input.weather, operation: "fallback" });
    const validation = validateOutfit(previous.outfit.itemIds, context);
    if (!validation.valid) throw new RecommendationError("NO_LEGAL_OUTFIT", "The previous outfit is no longer valid for the current wardrobe and preferences.", validation.violations.map((violation) => violation.code));
    const updated = DailySessionSchema.parse({
      ...session,
      status: "active",
      currentVersionId: previous.id,
      mainRecommendationId: previous.outfit.id,
      historyVersionIds: session.historyVersionIds.slice(0, -1),
      operationGeneration: session.operationGeneration + 1,
      updatedAt: Date.now(),
      confirmedAt: null,
    });
    await db.dailySessions.put(updated);
    return { outfit: previous.outfit, versionId: previous.id, session: updated };
  });
}

export async function confirmOutfitMutation(input: { sessionId: string; baseVersionId: string; expectedGeneration: number; outfit: Outfit; updatedProfile: PreferenceProfile }) {
  return db.transaction("rw", db.dailySessions, db.outfitVersions, db.wardrobeItems, db.preferenceProfiles, async () => {
    const session = await db.dailySessions.get(input.sessionId);
    if (!session || session.currentVersionId !== input.baseVersionId || session.operationGeneration !== input.expectedGeneration) stale();
    const version = await db.outfitVersions.get(input.baseVersionId);
    if (!version || version.sessionId !== input.sessionId || version.outfit.id !== input.outfit.id) stale("The displayed outfit does not match the persisted session version.");
    const now = Date.now();
    const updated = DailySessionSchema.parse({ ...session, status: "confirmed", confirmedAt: now, updatedAt: now, operationGeneration: session.operationGeneration + 1 });
    await db.dailySessions.put(updated);
    await db.preferenceProfiles.put(input.updatedProfile);
    const wornIds = Object.values(version.outfit.itemIds).filter((id): id is string => Boolean(id));
    await db.wardrobeItems.where("id").anyOf(wornIds).modify({ lastWornAt: now, updatedAt: now });
    return updated;
  });
}

export async function resetInvalidOutfitSession(input: { sessionId: string; expectedVersionId: string; expectedGeneration: number }) {
  return db.transaction("rw", db.dailySessions, async () => {
    const session = await db.dailySessions.get(input.sessionId);
    if (!session || session.currentVersionId !== input.expectedVersionId || session.operationGeneration !== input.expectedGeneration) stale();
    const updated = DailySessionSchema.parse({
      ...session,
      status: "draft",
      currentVersionId: null,
      mainRecommendationId: null,
      historyVersionIds: [],
      operationGeneration: session.operationGeneration + 1,
      updatedAt: Date.now(),
      confirmedAt: null,
    });
    await db.dailySessions.put(updated);
    return updated;
  });
}

export async function updateItemAvailabilityMutation(input: {
  itemId: string;
  availability: WardrobeItem["availability"];
  reason: string | null;
}) {
  return db.transaction("rw", db.wardrobeItems, async () => {
    const updated = await db.wardrobeItems.update(input.itemId, {
      availability: input.availability,
      unavailableReason: input.reason ?? undefined,
      updatedAt: Date.now(),
    });
    return updated ? db.wardrobeItems.toArray() : null;
  });
}
