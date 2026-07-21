import { describe, expect, it } from "vitest";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { runRecommendationDecision } from "@/domain/recommendation/engine";
import { normalizeSituationProfile } from "@/domain/recommendation/situation";
import { voiceActionToIntentDelta } from "@/domain/recommendation/voice-action-router";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";

const profile = createNeutralPreferenceProfile();

function intentFor(label: string) {
  return { ...demoIntent, activities: [{ label, timeOfDay: "unknown" as const }], freeformSummary: label, walkingIntensity: 2 };
}

describe("voice recommendation situation semantics", () => {
  it.each(["basketball", "gym workout", "running 5k"])("keeps %s free of unsafe optional accessories", (label) => {
    const decision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: intentFor(label), profile, weather: null, operation: "initial" });
    for (const candidate of decision.candidates) {
      expect(candidate.itemIds.bag).toBeUndefined();
      expect(candidate.itemIds.jewelry).toBeUndefined();
      expect(candidate.itemIds.extraAccessory).toBeUndefined();
      const shoes = demoWardrobe.find((item) => item.id === candidate.itemIds.shoes)!;
      expect([shoes.subtype, ...shoes.styleTags].join(" ").toLowerCase()).toMatch(/sneaker|trainer|running|athletic|sport|court/);
    }
  });

  it("normalizes hiking, lab, interview, wedding, rain commute and walking without conflating them", () => {
    expect(normalizeSituationProfile(intentFor("Hiking a trail")).kind).toBe("hiking");
    expect(normalizeSituationProfile(intentFor("Chemistry lab")).kind).toBe("lab");
    expect(normalizeSituationProfile(intentFor("Job interview")).kind).toBe("interview");
    expect(normalizeSituationProfile(intentFor("Wedding reception")).kind).toBe("wedding");
    expect(normalizeSituationProfile(intentFor("Rain commute")).kind).toBe("rain_commute");
    expect(normalizeSituationProfile({ ...intentFor("Class"), walkingIntensity: 5 }).kind).toBe("walking");
  });

  it("distinguishes playing from watching basketball and preserves ordered multi-activity context", () => {
    const playing = normalizeSituationProfile(intentFor("I am playing basketball after class"));
    const watching = normalizeSituationProfile(intentFor("I am watching a basketball game"));
    const multi = normalizeSituationProfile({
      ...intentFor("Play basketball, then dinner"),
      activities: [
        { label: "Play basketball", timeOfDay: "afternoon" as const },
        { label: "Dinner", timeOfDay: "evening" as const },
      ],
    });
    expect(playing.kind).toBe("court_sport");
    expect(playing.slotPolicy.jewelry).toBe("forbidden");
    expect(watching.kind).toBe("spectator_sport");
    expect(watching.slotPolicy.jewelry).toBe("optional");
    expect(multi.segments.map((segment) => segment.label)).toEqual(["Play basketball", "Dinner"]);
    expect(multi.segments.map((segment) => segment.timeOfDay)).toEqual(["afternoon", "evening"]);
  });

  it("uses situation semantics in legal search and deterministic scoring", () => {
    const hiking = runRecommendationDecision({ wardrobe: demoWardrobe, intent: intentFor("Hiking a trail"), profile, weather: null, operation: "initial" });
    expect(hiking.candidates.every((candidate) => /sneaker|trainer|boot|trail|hiking/.test(demoWardrobe.find((item) => item.id === candidate.itemIds.shoes)!.subtype.toLowerCase()))).toBe(true);

    const sandal = { ...demoWardrobe.find((item) => item.category === "shoes")!, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", subtype: "Open-toe sandal", comfort: 5, styleTags: ["clean"] };
    const lab = runRecommendationDecision({ wardrobe: [...demoWardrobe, sandal], intent: intentFor("Chemistry lab"), profile, weather: null, operation: "initial" });
    expect(lab.candidates.every((candidate) => candidate.itemIds.shoes !== sandal.id)).toBe(true);

    const dryOnly = { ...sandal, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", subtype: "Dry-only sneaker", weatherTags: ["dry_only"], styleTags: ["sporty"] };
    const commute = runRecommendationDecision({ wardrobe: [...demoWardrobe, dryOnly], intent: intentFor("Rain commute"), profile, weather: null, operation: "initial" });
    expect(commute.candidates.every((candidate) => candidate.itemIds.shoes !== dryOnly.id)).toBe(true);

    const interview = runRecommendationDecision({ wardrobe: demoWardrobe, intent: intentFor("Job interview"), profile, weather: null, operation: "initial" }).deterministicAnswer;
    const workout = runRecommendationDecision({ wardrobe: demoWardrobe, intent: intentFor("Gym workout"), profile, weather: null, operation: "initial" }).deterministicAnswer;
    const meanFormality = (ids: string[]) => ids.reduce((sum, id) => sum + demoWardrobe.find((item) => item.id === id)!.formality, 0) / ids.length;
    expect(meanFormality(Object.values(interview.itemIds).filter((id): id is string => Boolean(id)))).toBeGreaterThan(meanFormality(Object.values(workout.itemIds).filter((id): id is string => Boolean(id))));
  });

  it("rejects a required anchor that conflicts with activity safety", () => {
    const loafers = demoWardrobe.find((item) => item.subtype === "Black loafers")!;
    expect(() => runRecommendationDecision({ wardrobe: demoWardrobe, intent: { ...intentFor("Basketball"), requiredItemIds: [loafers.id] }, profile, weather: null, operation: "initial" }))
      .toThrowError(expect.objectContaining({ code: "CONFLICTING_REQUIRED_ITEMS" }));
  });

  it("resolves a named available hoodie locally as a required anchor", () => {
    const hoodie = { ...demoWardrobe.find((item) => item.category === "top")!, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", subtype: "Navy hoodie", primaryColor: "blue" as const, styleTags: ["relaxed", "sporty"] };
    const current = runRecommendationDecision({ wardrobe: [...demoWardrobe, hoodie], intent: demoIntent, profile, weather: null, operation: "initial" }).deterministicAnswer;
    const action = { action: "revise" as const, userRequest: "I want to wear my navy hoodie", targetSlot: null, targetDescription: "navy hoodie", availability: null };
    const delta = voiceActionToIntentDelta({ action, currentOutfit: current, wardrobe: [...demoWardrobe, hoodie], focusedSlot: null });
    expect(delta.requiredItemIds).toEqual([hoodie.id]);
    const revised = runRecommendationDecision({ wardrobe: [...demoWardrobe, hoodie], intent: demoIntent, profile, weather: null, operation: delta.operation === "targeted_revision" ? "targeted_revision" : "global_revision", currentOutfit: current, delta }).deterministicAnswer;
    expect(revised.itemIds.top).toBe(hoodie.id);
  });

  it("turns remove sunglasses into a required empty optional slot and preserves every other slot", () => {
    const initialDecision = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" });
    const current = initialDecision.candidates.find((candidate) => candidate.itemIds.extraAccessory)!;
    const removedId = current.itemIds.extraAccessory!;
    const action = { action: "remove" as const, userRequest: "Remove the sunglasses", targetSlot: null, targetDescription: "sunglasses", availability: null };
    const delta = voiceActionToIntentDelta({ action, currentOutfit: current, wardrobe: demoWardrobe, focusedSlot: null });
    const revised = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "targeted_revision", currentOutfit: current, delta }).deterministicAnswer;

    expect(delta.emptySlots).toEqual(["extraAccessory"]);
    expect(revised.itemIds.extraAccessory).toBeUndefined();
    expect(Object.values(revised.itemIds)).not.toContain(removedId);
    for (const slot of ["top", "bottom", "onePiece", "outerwear", "shoes", "bag", "jewelry"] as const) {
      expect(revised.itemIds[slot]).toBe(current.itemIds[slot]);
    }
  });

  it.each([
    ["No jewelry", "jewelry"],
    ["Remove the bag", "bag"],
  ] as const)("makes %s an empty-slot postcondition", (request, slot) => {
    const current = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).candidates.find((candidate) => candidate.itemIds[slot])!;
    const delta = voiceActionToIntentDelta({ action: { action: "remove", userRequest: request, targetSlot: null, targetDescription: null, availability: null }, currentOutfit: current, wardrobe: demoWardrobe, focusedSlot: null });
    const revised = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "targeted_revision", currentOutfit: current, delta }).deterministicAnswer;
    expect(revised.itemIds[slot]).toBeUndefined();
  });

  it("treats an explicitly kept slot as preservation, not the revision target", () => {
    const current = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).deterministicAnswer;
    const delta = voiceActionToIntentDelta({
      action: { action: "revise", userRequest: "Make it warmer but keep the shoes", targetSlot: "shoes", targetDescription: "shoes", availability: null },
      currentOutfit: current,
      wardrobe: demoWardrobe,
      focusedSlot: null,
    });

    expect(delta.operation).toBe("global_revision");
    expect(delta.targetSlots).toEqual([]);
    expect(delta.preserveSlots).toEqual(["shoes"]);
    expect(delta.adjustments.warmth).toBeGreaterThan(0);
    const revised = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "global_revision", currentOutfit: current, delta }).deterministicAnswer;
    expect(revised.itemIds.shoes).toBe(current.itemIds.shoes);
  });

  it("uses a semantic target description when the utterance itself is deictic", () => {
    const current = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial" }).candidates.find((candidate) => candidate.itemIds.extraAccessory)!;
    const delta = voiceActionToIntentDelta({
      action: { action: "remove", userRequest: "Remove this", targetSlot: null, targetDescription: "sunglasses", availability: null },
      currentOutfit: current,
      wardrobe: demoWardrobe,
      focusedSlot: null,
    });
    expect(delta.targetSlots).toEqual(["extraAccessory"]);
    expect(delta.emptySlots).toEqual(["extraAccessory"]);
  });
});
