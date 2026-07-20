import { describe, expect, it } from "vitest";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { applyPreferenceDelta } from "@/domain/preferences/profile-mutations";
import { recommendationPreferenceSummary } from "@/domain/preferences/summary";
import { preferenceDeltaForOption } from "@/domain/preferences/explicit-options";
import { demoPreferenceProfile } from "@/mocks/wardrobe";

describe("model-facing preference summary", () => {
  it("summarizes each active canonical signal once and omits descriptive direction metadata", () => {
    const profile = applyPreferenceDelta({
      profile: createNeutralPreferenceProfile(1),
      delta: preferenceDeltaForOption("more-relaxed"),
      now: 2,
    });
    const summary = recommendationPreferenceSummary({ ...profile, wardrobeDirection: "womenswear" });
    expect(summary.match(/Relaxed tailoring/g)).toHaveLength(1);
    expect(summary).not.toMatch(/womenswear|wardrobe direction/i);
  });

  it("does not expose review-only prose as a preference Sol may rank", () => {
    const profile = applyPreferenceDelta({
      profile: createNeutralPreferenceProfile(1),
      delta: {
        ...preferenceDeltaForOption("more-relaxed"),
        attribute: "preference_note",
        value: "maybe something unusual",
        label: "Maybe something unusual",
        needsReview: true,
      },
      now: 2,
    });
    expect(recommendationPreferenceSummary(profile)).toBe("Prefers balanced looks. Avoids nothing explicit.");
  });

  it("retains a truthful summary for the legacy demo fixture", () => {
    const summary = recommendationPreferenceSummary(demoPreferenceProfile);
    expect(summary).toContain("relaxed and clean");
    expect(summary).toContain("heels");
    expect(summary).not.toContain("clean layers");
  });
});
