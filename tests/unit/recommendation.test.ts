import { describe, expect, it } from "vitest";
import { changedAndPreserved, generateCandidates, reviseOverall, reviseTargeted, validateRankedIds } from "@/domain/recommendation/engine";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";

describe("deterministic recommendation", () => {
  it("creates legal candidates with shoes and no excluded one-piece", () => {
    const candidates = generateCandidates(demoWardrobe, demoIntent);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    for (const candidate of candidates) {
      expect(candidate.itemIds.shoes).toBeTruthy();
      expect(candidate.itemIds.onePiece).toBeUndefined();
      expect(candidate.itemIds.top).toBeTruthy();
      expect(candidate.itemIds.bottom).toBeTruthy();
    }
  });

  it("excludes unavailable items", () => {
    const blockedId = demoWardrobe[3].id;
    const wardrobe = demoWardrobe.map((item) => item.id === blockedId ? { ...item, availability: "laundry" as const } : item);
    const candidates = generateCandidates(wardrobe, demoIntent);
    expect(candidates.every((candidate) => !Object.values(candidate.itemIds).includes(blockedId))).toBe(true);
  });

  it("filters explicitly dry-only pieces when rain is expected", () => {
    const dryOnlyShoeId = demoWardrobe.find((item) => item.category === "shoes")!.id;
    const wardrobe = demoWardrobe.map((item) => item.id === dryOnlyShoeId ? { ...item, weatherTags: ["dry_only"] } : item);
    const candidates = generateCandidates(wardrobe, demoIntent, 8, { weather: { minApparentTempC: 11, maxApparentTempC: 16, precipitationProbability: 70, expectedRain: true, windy: false, summary: "Rain", sourceTimestamp: Date.now() } });
    expect(candidates.every((candidate) => candidate.itemIds.shoes !== dryOnlyShoeId)).toBe(true);
  });

  it("targeted bag revision preserves every other item", () => {
    const current = generateCandidates(demoWardrobe, demoIntent)[0];
    const revised = reviseTargeted(current, "bag", demoWardrobe, demoIntent);
    const before = { ...current.itemIds }; delete before.bag;
    const after = { ...revised.itemIds }; delete after.bag;
    expect(after).toEqual(before);
    expect(revised.itemIds.bag).not.toBe(current.itemIds.bag);
    const delta = changedAndPreserved(current, revised);
    expect(delta.changedItemIds).toHaveLength(2);
    expect(delta.preservedItemIds).toHaveLength(Object.values(before).filter(Boolean).length);
  });

  it("rejects invented, duplicate, or incomplete rank IDs", () => {
    const ids = generateCandidates(demoWardrobe, demoIntent).map((candidate) => candidate.id);
    expect(validateRankedIds(ids, ids.slice(0, 3))).toBe(true);
    expect(validateRankedIds(ids, [ids[0], ids[0], ids[1]])).toBe(false);
    expect(validateRankedIds(ids, [ids[0], ids[1], crypto.randomUUID()])).toBe(false);
  });

  it("can remove optional jewelry without changing another slot", () => {
    const current = generateCandidates(demoWardrobe, demoIntent)[0];
    const revised = reviseTargeted(current, "jewelry", demoWardrobe, demoIntent, "No jewelry today");
    expect(revised.itemIds.jewelry).toBeUndefined();
    const before = { ...current.itemIds }; delete before.jewelry;
    const after = { ...revised.itemIds }; delete after.jewelry;
    expect(after).toEqual(before);
  });

  it("bounds an overall revision to two changed core slots", () => {
    const current = generateCandidates(demoWardrobe, demoIntent)[0];
    const revised = reviseOverall(current, demoWardrobe, demoIntent, "The whole outfit feels too mature");
    const core = ["top", "bottom", "onePiece", "outerwear", "shoes"] as const;
    expect(revised.id).not.toBe(current.id);
    expect(core.filter((slot) => current.itemIds[slot] !== revised.itemIds[slot]).length).toBeLessThanOrEqual(2);
    expect(core.filter((slot) => current.itemIds[slot] && current.itemIds[slot] === revised.itemIds[slot]).length).toBeGreaterThanOrEqual(2);
  });
});
