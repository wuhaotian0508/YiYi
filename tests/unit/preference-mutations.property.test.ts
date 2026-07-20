import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import {
  activeLongTermPreferenceSignals,
  applyPreferenceDelta,
  rebuildProfileFromSignals,
  removePreferenceSignal,
} from "@/domain/preferences/profile-mutations";
import { PreferenceDeltaSchema, type PreferenceDelta } from "@/domain/schemas";

const now = 1_750_000_000_000;
const styles = ["polished", "relaxed", "minimal", "expressive", "classic", "utility"] as const;

function addStyle(value: string, needsReview = false): PreferenceDelta {
  return PreferenceDeltaSchema.parse({
    action: "add",
    signalId: null,
    attribute: "style",
    value,
    label: value.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
    polarity: "more",
    strength: "soft",
    scope: "global_style",
    categories: [],
    slots: [],
    combinationValues: [],
    confidence: 0.8,
    needsReview,
    evidenceSummary: null,
  });
}

describe("canonical preference mutation invariants", () => {
  it("is idempotent under repeated semantic additions and reversible by its stable ID", () => {
    fc.assert(fc.property(fc.constantFrom(...styles), (style) => {
      const neutral = createNeutralPreferenceProfile(now);
      const once = applyPreferenceDelta({ profile: neutral, delta: addStyle(style), now });
      const twice = applyPreferenceDelta({ profile: once, delta: addStyle(style), now: now + 1 });
      expect(twice.preferenceSignals).toHaveLength(1);
      expect(twice.preferenceSignals?.[0].id).toBe(once.preferenceSignals?.[0].id);

      const removed = removePreferenceSignal({ profile: twice, signalId: twice.preferenceSignals![0].id, now: now + 2 });
      expect(activeLongTermPreferenceSignals(removed)).toEqual([]);
      expect(removed.styleVector).toEqual(neutral.styleVector);
      expect(removed.styleAnchors).toEqual([]);
      expect(removed.softPreferences).toEqual([]);
    }), { numRuns: 60 });
  });

  it("rebuilds the same canonical projection independent of signal input order", () => {
    fc.assert(fc.property(fc.uniqueArray(fc.constantFrom(...styles), { minLength: 0, maxLength: styles.length }), (selected) => {
      let profile = createNeutralPreferenceProfile(now);
      for (const [index, style] of selected.entries()) {
        profile = applyPreferenceDelta({ profile, delta: addStyle(style), now: now + index });
      }
      const forward = rebuildProfileFromSignals({ profile, signals: profile.preferenceSignals, now: now + 100 });
      const reverse = rebuildProfileFromSignals({ profile, signals: [...(profile.preferenceSignals ?? [])].reverse(), now: now + 100 });
      expect(reverse).toEqual(forward);
      expect(rebuildProfileFromSignals({ profile: forward, now: now + 100 })).toEqual(forward);
    }), { numRuns: 60 });
  });

  it("never promotes review-only evidence into an active long-term signal", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...styles), { minLength: 0, maxLength: 30 }), (selected) => {
      let profile = createNeutralPreferenceProfile(now);
      for (const [index, style] of selected.entries()) {
        profile = applyPreferenceDelta({ profile, delta: addStyle(style, true), now: now + index });
      }
      expect(activeLongTermPreferenceSignals(profile)).toEqual([]);
      expect(profile.softPreferences).toEqual([]);
      expect(profile.preferenceNotes.moreOf).toEqual([]);
    }), { numRuns: 60 });
  });
});
