import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { runRecommendationDecision, validateRestoredOutfit } from "@/domain/recommendation/engine";
import { RecommendationError } from "@/domain/recommendation/context";
import { RecommendationOperationController } from "@/lib/recommendation/operation-controller";
import { commitOutfitMutation, confirmOutfitMutation, resetInvalidOutfitSession, undoOutfitMutation } from "@/lib/recommendation/session-mutations";
import { db, getExperienceMode, seedPreferences, seedWardrobe, setExperienceMode } from "@/lib/storage/db";
import { demoIntent, demoPreferenceProfile, demoWardrobe } from "@/mocks/wardrobe";

const sessionId = "99999999-9999-4999-8999-999999999991";
const dateKey = "2026-07-18";

async function resetDatabase() {
  db.close();
  await db.delete();
  await db.open();
}

describe("recommendation operation and persistence ordering", () => {
  beforeEach(resetDatabase);
  afterEach(async () => { db.close(); await db.delete(); });

  it("keeps commit and publish as an uninterruptible mutation boundary", () => {
    const controller = new RecommendationOperationController();
    const first = controller.begin(null);
    controller.enterCommit(first);
    expect(() => controller.begin(null)).toThrow("OUTFIT_OPERATION_IN_PROGRESS");
    controller.enterPublish(first);
    expect(() => controller.begin(null)).toThrow("OUTFIT_OPERATION_IN_PROGRESS");
    controller.finish(first);
    expect(controller.begin(null)).toMatchObject({ id: 2, phase: "preparing" });
  });

  it("clears a persisted current version that is no longer canonical", async () => {
    const outfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" }).deterministicAnswer;
    const committed = await commitOutfitMutation({ sessionId, dateKey, intent: demoIntent, weather: null, outfit, baseVersionId: null, expectedGeneration: 0, revisionRequest: null });
    const version = (await db.outfitVersions.get(committed.versionId))!;
    const unavailableId = outfit.itemIds.shoes;
    const changedWardrobe = demoWardrobe.map((item) => item.id === unavailableId ? { ...item, availability: "laundry" as const } : item);
    expect(validateRestoredOutfit({ version, wardrobe: changedWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null })).toMatchObject({ valid: false, reasons: ["ITEM_UNAVAILABLE"] });
    const repaired = await resetInvalidOutfitSession({ sessionId, expectedVersionId: committed.versionId, expectedGeneration: 1 });
    expect(repaired).toMatchObject({ currentVersionId: null, mainRecommendationId: null, historyVersionIds: [], operationGeneration: 2, status: "draft" });
    await expect(resetInvalidOutfitSession({ sessionId, expectedVersionId: committed.versionId, expectedGeneration: 1 })).rejects.toMatchObject({ code: "STALE_OPERATION" });
  });

  it("rejects stale commits and restores the exact persisted parent on undo", async () => {
    const profile = createNeutralPreferenceProfile();
    const firstOutfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).deterministicAnswer;
    const first = await commitOutfitMutation({ sessionId, dateKey, intent: demoIntent, weather: null, outfit: firstOutfit, baseVersionId: null, expectedGeneration: 0, revisionRequest: null });
    const secondOutfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "random_new_outfit", currentOutfit: firstOutfit, shownOutfitIds: [firstOutfit.id], requestId: "88888888-8888-4888-8888-888888888888" }).deterministicAnswer;
    const second = await commitOutfitMutation({ sessionId, dateKey, intent: demoIntent, weather: null, outfit: secondOutfit, baseVersionId: first.versionId, expectedGeneration: 1, revisionRequest: "Another outfit" });

    await expect(commitOutfitMutation({ sessionId, dateKey, intent: demoIntent, weather: null, outfit: firstOutfit, baseVersionId: first.versionId, expectedGeneration: 1, revisionRequest: "Late result" }))
      .rejects.toMatchObject({ code: "STALE_OPERATION" });

    const secondVersion = await db.outfitVersions.get(second.versionId);
    expect(secondVersion?.parentVersionId).toBe(first.versionId);
    expect(second.session.historyVersionIds).toEqual([first.versionId]);
    const undone = await undoOutfitMutation({ sessionId, baseVersionId: second.versionId, expectedGeneration: 2, wardrobe: demoWardrobe, profile, weather: null });
    expect(undone?.versionId).toBe(first.versionId);
    expect(undone?.outfit).toEqual(firstOutfit);
    expect(undone?.session.historyVersionIds).toEqual([]);
    expect(await undoOutfitMutation({ sessionId, baseVersionId: first.versionId, expectedGeneration: 3, wardrobe: demoWardrobe, profile, weather: null })).toBeNull();
  });

  it("cannot start a second operation after Dexie commit but before local publish", async () => {
    const controller = new RecommendationOperationController();
    const token = controller.begin(null);
    const outfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" }).deterministicAnswer;
    controller.enterCommit(token);
    const committed = await commitOutfitMutation({ sessionId, dateKey, intent: demoIntent, weather: null, outfit, baseVersionId: null, expectedGeneration: 0, revisionRequest: null });
    expect(() => controller.begin(null)).toThrow("OUTFIT_OPERATION_IN_PROGRESS");
    controller.enterPublish(token);
    const localPublishedVersionId = committed.versionId;
    const localPublishedGeneration = committed.session.operationGeneration;
    controller.finish(token);
    const persisted = await db.dailySessions.get(sessionId);
    expect({ versionId: localPublishedVersionId, generation: localPublishedGeneration }).toEqual({ versionId: persisted?.currentVersionId, generation: persisted?.operationGeneration });
  });

  it("refuses to undo into a historical outfit that is no longer canonical", async () => {
    const profile = createNeutralPreferenceProfile();
    const firstOutfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).deterministicAnswer;
    const first = await commitOutfitMutation({ sessionId, dateKey, intent: demoIntent, weather: null, outfit: firstOutfit, baseVersionId: null, expectedGeneration: 0, revisionRequest: null });
    const secondOutfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "random_new_outfit", currentOutfit: firstOutfit, shownOutfitIds: [firstOutfit.id], requestId: "77777777-7777-4777-8777-777777777777" }).deterministicAnswer;
    const second = await commitOutfitMutation({ sessionId, dateKey, intent: demoIntent, weather: null, outfit: secondOutfit, baseVersionId: first.versionId, expectedGeneration: 1, revisionRequest: "Another" });
    const changedWardrobe = demoWardrobe.map((item) => item.id === firstOutfit.itemIds.shoes ? { ...item, availability: "laundry" as const } : item);
    await expect(undoOutfitMutation({ sessionId, baseVersionId: second.versionId, expectedGeneration: 2, wardrobe: changedWardrobe, profile, weather: null })).rejects.toMatchObject({ code: "NO_LEGAL_OUTFIT" });
    expect((await db.dailySessions.get(sessionId))?.currentVersionId).toBe(second.versionId);
  });

  it("does not confirm an outfit that differs from the persisted current version", async () => {
    const profile = createNeutralPreferenceProfile();
    await db.wardrobeItems.bulkPut(demoWardrobe);
    const firstOutfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).deterministicAnswer;
    const first = await commitOutfitMutation({ sessionId, dateKey, intent: demoIntent, weather: null, outfit: firstOutfit, baseVersionId: null, expectedGeneration: 0, revisionRequest: null });
    const different = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "random_new_outfit", currentOutfit: firstOutfit, shownOutfitIds: [firstOutfit.id] }).deterministicAnswer;
    await expect(confirmOutfitMutation({ sessionId, baseVersionId: first.versionId, expectedGeneration: 1, outfit: different, updatedProfile: profile }))
      .rejects.toEqual(expect.objectContaining<Partial<RecommendationError>>({ code: "STALE_OPERATION" }));
    const session = await db.dailySessions.get(sessionId);
    expect(session?.status).toBe("active");
    expect((await db.wardrobeItems.toArray()).every((item) => item.lastWornAt === demoWardrobe.find((original) => original.id === item.id)?.lastWornAt)).toBe(true);
  });

  it("confirms the exact version atomically with profile and wear history", async () => {
    const profile = createNeutralPreferenceProfile();
    await db.wardrobeItems.bulkPut(demoWardrobe);
    const outfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).deterministicAnswer;
    const initial = await commitOutfitMutation({ sessionId, dateKey, intent: demoIntent, weather: null, outfit, baseVersionId: null, expectedGeneration: 0, revisionRequest: null });
    const confirmed = await confirmOutfitMutation({ sessionId, baseVersionId: initial.versionId, expectedGeneration: 1, outfit, updatedProfile: profile });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.operationGeneration).toBe(2);
    expect(await db.preferenceProfiles.get("default")).toEqual(profile);
    const worn = await db.wardrobeItems.bulkGet(Object.values(outfit.itemIds).filter((id): id is string => Boolean(id)));
    expect(worn.every((item) => typeof item?.lastWornAt === "number")).toBe(true);
  });

  it("removes demo provenance without deleting a newly saved personal item", async () => {
    await seedWardrobe(demoWardrobe, { explicit: true });
    await seedPreferences(demoPreferenceProfile);
    const outfit = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: demoPreferenceProfile, weather: null, operation: "initial" }).deterministicAnswer;
    await commitOutfitMutation({ sessionId, dateKey, intent: demoIntent, weather: null, outfit, baseVersionId: null, expectedGeneration: 0, revisionRequest: null });
    const personal = { ...demoWardrobe[2], id: "77777777-7777-4777-8777-777777777799", dataProvenance: "personal" as const };
    await db.wardrobeItems.put(personal);

    await setExperienceMode("personal");
    await seedWardrobe(demoWardrobe);

    expect(await getExperienceMode()).toBe("personal");
    expect((await db.wardrobeItems.toArray()).map((item) => item.id)).toEqual([personal.id]);
    expect(await db.preferenceProfiles.get("default")).toBeUndefined();
    expect(await db.dailySessions.count()).toBe(0);
    expect(await db.outfitVersions.count()).toBe(0);
  });
});
