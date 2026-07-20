import { describe, expect, it } from "vitest";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { buildCalibrationPreferenceProfile, createCalibrationResponse } from "@/domain/preferences/calibration-engine";
import { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";
import {
  activeLongTermPreferenceSignals,
  applyPreferenceDelta,
  rebuildProfileFromSignals,
  removePreferenceSignal,
} from "@/domain/preferences/profile-mutations";
import { createRecommendationContext } from "@/domain/recommendation/context";
import { validateOutfit } from "@/domain/recommendation/constraints";
import { runRecommendationDecision } from "@/domain/recommendation/engine";
import { scoreCandidate, scoreItemHeuristic } from "@/domain/recommendation/scoring";
import { PreferenceDeltaSchema, PreferenceProfileSchema, PreferenceSignalSchema, type PreferenceDelta, type PreferenceProfile } from "@/domain/schemas";
import { demoIntent, demoPreferenceProfile, demoWardrobe } from "@/mocks/wardrobe";

const now = 1_750_000_000_000;

function delta(overrides: Partial<PreferenceDelta> = {}): PreferenceDelta {
  return PreferenceDeltaSchema.parse({
    action: "add",
    signalId: null,
    attribute: "style",
    value: "polished",
    label: "Polished",
    polarity: "more",
    strength: "soft",
    scope: "global_style",
    categories: [],
    slots: [],
    combinationValues: [],
    confidence: 0.9,
    needsReview: false,
    evidenceSummary: "I usually prefer polished outfits.",
    ...overrides,
  });
}

function context(profile: PreferenceProfile) {
  return createRecommendationContext({
    wardrobe: demoWardrobe,
    intent: { ...demoIntent, aestheticTerms: [] },
    profile,
    weather: null,
    operation: "initial",
  });
}

describe("canonical preference mutations", () => {
  it("does not count Both or Neither twice when rebuilding calibration confidence", () => {
    const responses = [
      createCalibrationResponse(calibrationCatalogV2.questions[0].id, "both", now),
      createCalibrationResponse(calibrationCatalogV2.questions[1].id, "neither", now + 1),
    ];
    const profile = buildCalibrationPreferenceProfile({ direction: "neutral", responses, now: now + 2 });
    const rebuilt = rebuildProfileFromSignals({ profile, now: now + 3 });
    expect(rebuilt.profileConfidence).toEqual(profile.profileConfidence);
  });

  it("adds one stable, provenance-bearing signal and updates the canonical projections", () => {
    const first = applyPreferenceDelta({ profile: createNeutralPreferenceProfile(now), delta: delta(), now, source: "explicit_voice" });
    const repeated = applyPreferenceDelta({ profile: first, delta: delta(), now: now + 1, source: "explicit_voice" });

    expect(first.preferenceSignals).toHaveLength(1);
    expect(repeated.preferenceSignals).toHaveLength(1);
    expect(repeated.preferenceSignals?.[0]).toMatchObject({
      id: first.preferenceSignals?.[0].id,
      attribute: "style",
      value: "polished",
      polarity: "more",
      status: "active",
      permanence: "long_term",
      provenance: { source: "explicit_voice", sourceId: first.preferenceSignals?.[0].id, createdAt: now + 1 },
    });
    expect(repeated.preferenceNotes).toMatchObject({ moreOf: ["Polished"], lessOf: [] });
    expect(repeated.profileConfidence?.overall).toBeGreaterThan(0);
    expect(repeated.evidence).toEqual([{ phrase: "I usually prefer polished outfits.", source: "explicit_voice", createdAt: now + 1 }]);
    expect(repeated.softPreferences).toEqual([
      expect.objectContaining({ key: "style", value: "polished", polarity: "prefer", strength: "soft" }),
    ]);
  });

  it("materializes an explicit edit from Demo onto a neutral personal profile", () => {
    const personal = applyPreferenceDelta({ profile: demoPreferenceProfile, delta: delta({ value: "minimal", label: "Minimal" }), now });

    expect(personal.provenance).toBe("personal");
    expect(personal.wardrobeDirection).toBe("neutral");
    expect(personal.preferenceSignals).toEqual([expect.objectContaining({ value: "minimal", status: "active" })]);
    expect(personal.preferenceNotes.moreOf).toEqual(["Minimal"]);
    expect(personal.preferenceNotes.lessOf).toEqual([]);
    expect(personal.hardAvoids).toEqual([]);
    expect(personal.preferredMetals).toEqual([]);
    expect(personal.styleAnchors).toEqual([]);
  });

  it("edits an existing signal in place instead of leaving a stale scoring rule", () => {
    const polished = applyPreferenceDelta({ profile: createNeutralPreferenceProfile(now), delta: delta(), now });
    const signalId = polished.preferenceSignals![0].id;
    const relaxed = applyPreferenceDelta({
      profile: polished,
      delta: delta({ signalId, value: "relaxed", label: "Relaxed" }),
      now: now + 1,
      source: "profile_edit",
    });

    expect(relaxed.preferenceSignals).toHaveLength(1);
    expect(relaxed.preferenceSignals?.[0]).toMatchObject({ id: signalId, value: "relaxed", label: "Relaxed", provenance: { source: "profile_edit" } });
    expect(relaxed.preferenceNotes.moreOf).toEqual(["Relaxed"]);
    expect(relaxed.softPreferences).toEqual([expect.objectContaining({ value: "relaxed" })]);
  });

  it("keeps needs-review, deleted, unknown, and contextual evidence out of long-term scoring", () => {
    const neutral = createNeutralPreferenceProfile(now);
    const polishedTop = demoWardrobe.find((item) => item.category === "outerwear" && item.styleTags.includes("polished"))!;
    const baseline = scoreItemHeuristic(polishedTop, context(neutral));
    const canonical = applyPreferenceDelta({ profile: neutral, delta: delta({ needsReview: true }), now });
    const contextual = PreferenceSignalSchema.parse({
      ...canonical.preferenceSignals?.[0],
      id: "contextual:polished",
      status: "active",
      scope: "contextual",
      permanence: "contextual",
      provenance: { source: "contextual_revision", createdAt: now },
    });
    const unknown = PreferenceSignalSchema.parse({
      ...canonical.preferenceSignals?.[0],
      id: "unknown:polished",
      polarity: "unknown",
      confidence: 0,
      status: "active",
    });
    const profile = rebuildProfileFromSignals({ profile: canonical, signals: [...(canonical.preferenceSignals ?? []), contextual, unknown], now });

    expect(activeLongTermPreferenceSignals(profile)).toEqual([]);
    expect(scoreItemHeuristic(polishedTop, context(profile))).toBeCloseTo(baseline, 12);
  });

  it("prunes old contextual evidence before durable preferences at the profile bound", () => {
    const durable = applyPreferenceDelta({ profile: createNeutralPreferenceProfile(now), delta: delta(), now });
    const contextual = Array.from({ length: 120 }, (_, index) => PreferenceSignalSchema.parse({
      id: `context:${index}`,
      attribute: "style",
      value: `context-${index}`,
      label: `Context ${index}`,
      polarity: "more",
      strength: "soft",
      confidence: 0.1,
      scope: "contextual",
      categories: [],
      slots: [],
      permanence: "contextual",
      editable: true,
      status: "active",
      combinationValues: [],
      styleTags: [],
      provenance: { source: "contextual_revision", sourceId: `session-${index}`, createdAt: now + index + 1 },
    }));
    const rebuilt = rebuildProfileFromSignals({ profile: durable, signals: [...durable.preferenceSignals!, ...contextual], now: now + 200 });

    expect(rebuilt.preferenceSignals).toHaveLength(100);
    expect(rebuilt.preferenceSignals?.some((signal) => signal.value === "polished" && signal.permanence === "long_term")).toBe(true);
    expect(activeLongTermPreferenceSignals(rebuilt)).toHaveLength(1);
  });

  it("ignores a stale style vector and anchors when their canonical evidence needs review", () => {
    const calibrated = buildCalibrationPreferenceProfile({
      direction: "neutral",
      responses: [createCalibrationResponse(calibrationCatalogV2.questions[0].id, "a", now)],
      now,
    });
    const reviewOnly = PreferenceProfileSchema.parse({
      ...calibrated,
      preferenceSignals: calibrated.preferenceSignals?.map((signal) => ({ ...signal, status: "needs_review" as const })),
      // Deliberately retain stale derived fields to model an interrupted legacy write.
      styleVector: calibrated.styleVector,
      styleAnchors: calibrated.styleAnchors,
    });
    const item = demoWardrobe.find((entry) => entry.category === "outerwear" && entry.styleTags.includes("polished"))!;

    expect(scoreItemHeuristic(item, context(reviewOnly)))
      .toBeCloseTo(scoreItemHeuristic(item, context(createNeutralPreferenceProfile(now))), 12);
  });

  it("turns equal amounts of different calibration evidence into opposite scoring directions", () => {
    const question = calibrationCatalogV2.questions.find((entry) => entry.id === "minimal-or-expressive")!;
    const minimalProfile = buildCalibrationPreferenceProfile({ direction: "neutral", responses: [createCalibrationResponse(question.id, "a", now)], now });
    const expressiveProfile = buildCalibrationPreferenceProfile({ direction: "neutral", responses: [createCalibrationResponse(question.id, "b", now)], now });
    const template = demoWardrobe.find((item) => item.category === "top")!;
    const minimalItem = { ...template, styleTags: ["minimal", "clean"] };
    const expressiveItem = { ...template, styleTags: ["expressive", "colorful"] };

    expect(scoreItemHeuristic(minimalItem, context(minimalProfile))).toBeGreaterThan(scoreItemHeuristic(expressiveItem, context(minimalProfile)));
    expect(scoreItemHeuristic(expressiveItem, context(expressiveProfile))).toBeGreaterThan(scoreItemHeuristic(minimalItem, context(expressiveProfile)));
  });

  it("removes by stable signal ID, keeps an audit tombstone, and reverses ranking influence", () => {
    const neutral = createNeutralPreferenceProfile(now);
    const polished = applyPreferenceDelta({ profile: neutral, delta: delta(), now });
    const signalId = polished.preferenceSignals?.[0].id;
    expect(signalId).toBeTruthy();
    const polishedTop = demoWardrobe.find((item) => item.category === "outerwear" && item.styleTags.includes("polished"))!;
    const baseline = scoreItemHeuristic(polishedTop, context(neutral));
    expect(scoreItemHeuristic(polishedTop, context(polished))).toBeGreaterThan(baseline);

    const removed = removePreferenceSignal({ profile: polished, signalId: signalId!, now: now + 1 });
    expect(removed.preferenceSignals?.find((signal) => signal.id === signalId)).toMatchObject({ status: "deleted" });
    expect(activeLongTermPreferenceSignals(removed)).toEqual([]);
    expect(removed.preferenceNotes.moreOf).toEqual([]);
    expect(removed.softPreferences).toEqual([]);
    expect(removed.evidence.at(-1)).toEqual({ phrase: "Removed preference: Polished", source: "profile_edit", createdAt: now + 1 });
    expect(scoreItemHeuristic(polishedTop, context(removed))).toBeCloseTo(baseline, 12);
  });

  it("does not score raw freeform prose as a hidden positive preference", () => {
    const neutral = createNeutralPreferenceProfile(now);
    const proseOnly = PreferenceProfileSchema.parse({
      ...neutral,
      schemaVersion: 2,
      preferenceSignals: [],
      preferenceNotes: { ...neutral.preferenceNotes, freeform: "I never want polished tailoring." },
    });
    const polishedOutfit = {
      top: "22222222-2222-4222-8222-222222222221",
      bottom: "33333333-3333-4333-8333-333333333332",
      outerwear: "11111111-1111-4111-8111-111111111113",
      shoes: "44444444-4444-4444-8444-444444444442",
    };

    expect(scoreCandidate(polishedOutfit, context(proseOnly)).scoreTrace?.dimensions.personalFit)
      .toBeCloseTo(scoreCandidate(polishedOutfit, context(neutral)).scoreTrace!.dimensions.personalFit, 12);
  });

  it("enforces an explicit hard combination only when the whole combination is present", () => {
    const profile = applyPreferenceDelta({
      profile: createNeutralPreferenceProfile(now),
      delta: delta({
        attribute: "combination",
        value: "black-white-together",
        label: "Black and white together",
        polarity: "less",
        strength: "hard",
        combinationValues: ["black", "white"],
      }),
      now,
    });
    const recommendationContext = context(profile);
    const blackAndWhite = {
      top: "22222222-2222-4222-8222-222222222221",
      bottom: "33333333-3333-4333-8333-333333333332",
      shoes: "44444444-4444-4444-8444-444444444442",
    };
    const blackOnly = {
      top: "22222222-2222-4222-8222-222222222223",
      bottom: "33333333-3333-4333-8333-333333333332",
      shoes: "44444444-4444-4444-8444-444444444442",
    };
    const whiteOnly = {
      top: "22222222-2222-4222-8222-222222222221",
      bottom: "33333333-3333-4333-8333-333333333331",
      shoes: "44444444-4444-4444-8444-444444444441",
    };

    expect(validateOutfit(blackAndWhite, recommendationContext)).toMatchObject({ valid: false, violations: [expect.objectContaining({ code: "HARD_AVOID" })] });
    expect(validateOutfit(blackOnly, recommendationContext)).toEqual({ valid: true, violations: [] });
    expect(validateOutfit(whiteOnly, recommendationContext)).toEqual({ valid: true, violations: [] });
    expect(() => runRecommendationDecision({
      wardrobe: demoWardrobe,
      intent: { ...demoIntent, requiredItemIds: [blackAndWhite.top, blackAndWhite.bottom] },
      profile,
      weather: null,
      operation: "initial",
    })).toThrowError(expect.objectContaining({ code: "CONFLICTING_REQUIRED_ITEMS", message: expect.stringContaining("Black and white together") }));
    expect(PreferenceDeltaSchema.safeParse({
      ...delta(),
      attribute: "combination",
      value: "duplicate-black",
      combinationValues: ["Black", "black"],
    }).success).toBe(false);
  });
});
