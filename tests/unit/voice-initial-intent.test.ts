import { describe, expect, it } from "vitest";
import { buildDailyIntentFromVoiceRequest, resolveSemanticItemAnchors } from "@/domain/recommendation/voice-intent";
import { voiceActionToIntentDelta } from "@/domain/recommendation/voice-action-router";
import { runRecommendationDecision } from "@/domain/recommendation/engine";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";

describe("voice intent extraction without Demo leakage", () => {
  it("creates distinct intent labels for distinct utterances and never injects Gallery", () => {
    const utterances = [
      "I have a lab this morning.",
      "I am playing basketball after class.",
      "Dinner with friends tonight, relaxed but put together.",
      "A rainy commute with lots of walking.",
      "I want to wear my navy hoodie for class.",
    ];
    const intents = utterances.map((userRequest) => buildDailyIntentFromVoiceRequest({ userRequest, activityPhrases: [], desiredFeelings: [], exclusions: [], wardrobeAnchors: [] }, demoWardrobe));
    expect(new Set(intents.map((intent) => JSON.stringify([intent.activities, intent.aestheticTerms, intent.requiredItemIds, intent.excludedCategories]))).size).toBe(utterances.length);
    expect(intents.every((intent) => !JSON.stringify(intent).includes("Gallery"))).toBe(true);
  });

  it("adds Gallery only when the current utterance explicitly names it", () => {
    const named = buildDailyIntentFromVoiceRequest({ userRequest: "Gallery this afternoon, then dinner.", activityPhrases: [], desiredFeelings: [], exclusions: [], wardrobeAnchors: [] }, demoWardrobe);
    const unnamed = buildDailyIntentFromVoiceRequest({ userRequest: "Dinner with friends tonight.", activityPhrases: [], desiredFeelings: [], exclusions: [], wardrobeAnchors: [] }, demoWardrobe);
    expect(named.activities.map((activity) => activity.label)).toContain("Gallery");
    expect(unnamed.activities.map((activity) => activity.label)).not.toContain("Gallery");
  });

  it("does not turn a positive dress request into No dresses", () => {
    const intent = buildDailyIntentFromVoiceRequest({ userRequest: "I want to wear a dress to dinner.", activityPhrases: ["dinner"], desiredFeelings: [], exclusions: [], wardrobeAnchors: ["dress"] }, demoWardrobe);
    expect(intent.excludedCategories).not.toContain("one_piece");
  });

  it("resolves a semantic navy hoodie anchor to the one available local item", () => {
    const hoodie = { ...demoWardrobe.find((item) => item.category === "top")!, id: "10101010-1010-4010-8010-101010101010", subtype: "Hoodie", primaryColor: "navy" as const, availability: "available" as const };
    const wardrobe = [...demoWardrobe, hoodie];
    expect(resolveSemanticItemAnchors(["my navy hoodie"], wardrobe)).toEqual({ requiredItemIds: [hoodie.id], ambiguity: [] });
    const intent = buildDailyIntentFromVoiceRequest({ userRequest: "Wear my navy hoodie.", activityPhrases: [], desiredFeelings: [], exclusions: [], wardrobeAnchors: ["my navy hoodie"] }, wardrobe);
    expect(intent.requiredItemIds).toEqual([hoodie.id]);
    expect(runRecommendationDecision({ wardrobe, intent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" }).candidates.every((candidate) => Object.values(candidate.itemIds).includes(hoodie.id))).toBe(true);
  });

  it("does not treat style words or negative colour language as required items", () => {
    const current = runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: createNeutralPreferenceProfile(), weather: null, operation: "initial" }).deterministicAnswer;
    const relaxed = voiceActionToIntentDelta({
      action: { action: "revise", userRequest: "Make it casual and relaxed", targetSlot: null, targetDescription: null, availability: null },
      currentOutfit: current,
      wardrobe: demoWardrobe,
      focusedSlot: null,
    });
    const lessBlue = voiceActionToIntentDelta({
      action: { action: "revise", userRequest: "Make it less blue", targetSlot: null, targetDescription: null, availability: null },
      currentOutfit: current,
      wardrobe: demoWardrobe,
      focusedSlot: null,
    });
    expect(relaxed.requiredItemIds).toEqual([]);
    expect(lessBlue.requiredItemIds).toEqual([]);
    expect(lessBlue.temporaryRules).toEqual(expect.arrayContaining([expect.objectContaining({ key: "color", value: "blue", polarity: "avoid" })]));
  });
});
