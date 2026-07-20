import { describe, expect, it } from "vitest";
import { explicitPreferenceOptions, preferenceDeltaForOption } from "@/domain/preferences/explicit-options";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { applyPreferenceDelta } from "@/domain/preferences/profile-mutations";
import { matchesPreferenceSignal } from "@/domain/preferences/preference-matching";
import { createRecommendationContext } from "@/domain/recommendation/context";
import { scoreItemHeuristic } from "@/domain/recommendation/scoring";
import type { WardrobeItem } from "@/domain/schemas";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";

function item(input: Partial<WardrobeItem>): WardrobeItem {
  return {
    ...demoWardrobe.find((candidate) => candidate.category === "top")!,
    id: crypto.randomUUID(),
    ...input,
  };
}

const matchingItems: Record<string, WardrobeItem> = {
  "more-relaxed": item({ styleTags: ["relaxed"] }),
  "more-clean": item({ styleTags: ["clean"] }),
  "more-sporty": item({ styleTags: ["sporty"] }),
  "more-soft": item({ styleTags: ["soft"] }),
  "more-color": item({ primaryColor: "red" }),
  "more-minimal": item({ styleTags: ["minimal"] }),
  "less-heels": item({ category: "shoes", subtype: "Block heels" }),
  "less-tight": item({ fit: "slim" }),
  "less-cropped": item({ category: "top", fit: "cropped" }),
  "less-short-skirts": item({ category: "bottom", subtype: "Mini skirt" }),
  "less-bright": item({ primaryColor: "blue" }),
  "less-formal": item({ formality: 5 }),
  "less-gold": item({ category: "jewelry", metal: "gold" }),
  "less-silver": item({ category: "jewelry", metal: "silver" }),
};

describe("explicit preference options", () => {
  it("maps every visible chip to an active canonical signal that matches a real wardrobe attribute", () => {
    for (const [index, option] of explicitPreferenceOptions.entries()) {
      const delta = preferenceDeltaForOption(option.id);
      const profile = applyPreferenceDelta({ profile: createNeutralPreferenceProfile(1), delta, now: index + 2, source: "explicit_edit" });
      const signal = profile.preferenceSignals?.find((candidate) => candidate.label === option.label);
      expect(signal, option.id).toMatchObject({ status: "active", polarity: option.polarity });
      expect(matchesPreferenceSignal(matchingItems[option.id]!, signal!), option.id).toBe(true);
    }
  });

  it("rejects unknown option IDs instead of degrading them to an unscored note", () => {
    expect(() => preferenceDeltaForOption("not-a-real-option")).toThrow("Unknown explicit preference option");
  });

  it("moves heuristic scoring in the declared direction for every visible option", () => {
    const neutral = createNeutralPreferenceProfile(1);
    for (const [index, option] of explicitPreferenceOptions.entries()) {
      const wardrobeItem = matchingItems[option.id]!;
      const wardrobe = [...demoWardrobe, wardrobeItem];
      const baselineContext = createRecommendationContext({ wardrobe, intent: demoIntent, profile: neutral, weather: null, operation: "initial" });
      const profile = applyPreferenceDelta({ profile: neutral, delta: preferenceDeltaForOption(option.id), now: index + 2 });
      const personalizedContext = createRecommendationContext({ wardrobe, intent: demoIntent, profile, weather: null, operation: "initial" });
      const baseline = scoreItemHeuristic(wardrobeItem, baselineContext);
      const personalized = scoreItemHeuristic(wardrobeItem, personalizedContext);
      if (option.polarity === "more") expect(personalized, option.id).toBeGreaterThan(baseline);
      else expect(personalized, option.id).toBeLessThan(baseline);
    }
  });
});
