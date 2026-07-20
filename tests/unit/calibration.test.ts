import { describe, expect, it } from "vitest";
import { calibrationCatalogV2, type CalibrationCatalog } from "@/domain/preferences/calibration-catalog";
import {
  CalibrationContractError,
  buildCalibrationPreferenceProfile,
  canonicalizeCalibrationResponses,
  createCalibrationResponse,
  deriveCalibrationModel,
  upsertCalibrationResponse,
} from "@/domain/preferences/calibration-engine";

const now = 1_750_000_000_000;

function response(questionIndex: number, choice: "a" | "b" | "both" | "neither" | "skip") {
  return createCalibrationResponse(calibrationCatalogV2.questions[questionIndex].id, choice, now + questionIndex);
}

describe("pairwise style calibration", () => {
  it("ships a versioned six-question controlled-image catalog", () => {
    expect(calibrationCatalogV2).toMatchObject({
      id: "yiyi-style-calibration",
      version: 2,
      method: "pairwise_with_absolute_escape_hatches",
      presentation: {
        subject: "headless_mannequin",
        background: "controlled_neutral",
        framing: "full_outfit",
        intendedQuestion: "would_wear",
      },
    });
    expect(calibrationCatalogV2.questions).toHaveLength(6);
    expect(new Set(calibrationCatalogV2.questions.map((question) => question.id)).size).toBe(6);
    for (const question of calibrationCatalogV2.questions) {
      expect(question.asset.src).toMatch(/^\/style-calibration\/v2\/.+\.webp$/);
      expect(question.optionA.id).not.toBe(question.optionB.id);
    }
  });

  it("treats an A/B loser as unknown relative evidence, never as Less of", () => {
    const question = calibrationCatalogV2.questions[0];
    const profile = buildCalibrationPreferenceProfile({
      direction: "neutral",
      responses: [response(0, "a")],
      now,
    });

    expect(profile.preferenceSignals).toEqual([
      expect.objectContaining({ value: question.optionA.id, polarity: "more", scope: "relative_pair" }),
      expect.objectContaining({ value: question.optionB.id, polarity: "unknown", scope: "relative_pair", confidence: 0 }),
    ]);
    expect(profile.preferenceNotes.moreOf).toEqual([question.optionA.label]);
    expect(profile.preferenceNotes.lessOf).toEqual([]);
    expect(profile.softPreferences.some((rule) => rule.polarity === "avoid")).toBe(false);
  });

  it("keeps Both, Neither, and Skip semantically distinct", () => {
    const both = deriveCalibrationModel([response(0, "both")], { now });
    expect(both.signals).toHaveLength(2);
    expect(both.signals.every((signal) => signal.polarity === "more")).toBe(true);

    const neither = deriveCalibrationModel([response(0, "neither")], { now });
    expect(neither.signals).toHaveLength(2);
    expect(neither.signals.every((signal) => signal.polarity === "less" && signal.strength === "soft")).toBe(true);
    expect(neither.signals.every((signal) => signal.permanence === "onboarding_seed" && signal.editable)).toBe(true);
    expect(neither.styleVector).toEqual({
      relaxedPolished: 0,
      minimalExpressive: 0,
      softCool: 0,
      fittedOversized: 0,
      classicTrendAware: 0,
      feminineNeutral: 0,
    });

    const skip = deriveCalibrationModel([response(0, "skip")], { now });
    expect(skip.signals).toEqual([]);
    expect(skip.confidence).toEqual({ evidence: 0, coverage: 0, differentiation: 0, overall: 0 });
  });

  it("does not invent negative preferences when every answer is Both", () => {
    const responses = calibrationCatalogV2.questions.map((_, index) => response(index, "both"));
    const profile = buildCalibrationPreferenceProfile({ direction: "mixed", responses, now });
    expect(profile.preferenceSignals?.filter((signal) => signal.polarity === "more")).toHaveLength(12);
    expect(profile.preferenceSignals?.some((signal) => signal.polarity === "less")).toBe(false);
    expect(profile.preferenceNotes.lessOf).toEqual([]);
    expect(profile.profileConfidence?.differentiation).toBe(0);
    expect(profile.profileConfidence?.overall).toBeLessThan(0.3);
  });

  it("keeps an all-Skip profile neutral with zero confidence", () => {
    const responses = calibrationCatalogV2.questions.map((_, index) => response(index, "skip"));
    const profile = buildCalibrationPreferenceProfile({ direction: "neutral", responses, now });
    expect(profile.styleVector).toEqual({
      relaxedPolished: 0,
      minimalExpressive: 0,
      softCool: 0,
      fittedOversized: 0,
      classicTrendAware: 0,
      feminineNeutral: 0,
    });
    expect(profile.styleAnchors).toEqual([]);
    expect(profile.preferenceSignals).toEqual([]);
    expect(profile.preferenceNotes).toEqual({ moreOf: [], lessOf: [], freeform: "" });
    expect(profile.profileConfidence).toEqual({ evidence: 0, coverage: 0, differentiation: 0, overall: 0 });
  });

  it("learns different profiles from equal amounts of different style evidence", () => {
    const minimal = deriveCalibrationModel([response(1, "a"), response(5, "a")], { now });
    const expressive = deriveCalibrationModel([response(1, "b"), response(5, "b")], { now });
    expect(minimal.responses).toHaveLength(expressive.responses.length);
    expect(minimal.styleVector.minimalExpressive).toBeLessThan(0);
    expect(expressive.styleVector.minimalExpressive).toBeGreaterThan(0);
    expect(minimal.styleVector.minimalExpressive).not.toBe(expressive.styleVector.minimalExpressive);
  });

  it("keeps semantic inference independent from the presentation asset", () => {
    const presentationVariant: CalibrationCatalog = {
      ...calibrationCatalogV2,
      questions: calibrationCatalogV2.questions.map((question, index) => ({
        ...question,
        asset: calibrationCatalogV2.questions[(index + 1) % calibrationCatalogV2.questions.length].asset,
      })),
    };
    const answers = [response(0, "a"), response(1, "b"), response(2, "both")];
    expect(deriveCalibrationModel(answers, { now, catalog: presentationVariant }))
      .toEqual(deriveCalibrationModel(answers, { now, catalog: calibrationCatalogV2 }));
  });

  it("writes canonical provenance without breaking legacy profile fields", () => {
    const profile = buildCalibrationPreferenceProfile({
      direction: "womenswear",
      responses: [response(2, "b")],
      moreOf: ["Silver jewelry"],
      lessOf: ["Loud logos"],
      freeform: "I like simple layers.",
      revision: 3,
      now,
    });

    expect(profile).toMatchObject({ schemaVersion: 2, origin: "calibration", revision: 3, provenance: "personal" });
    expect(profile.calibrationResponses).toHaveLength(1);
    expect(profile.preferenceSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        polarity: "more",
        provenance: expect.objectContaining({ source: "calibration_pairwise", catalogVersion: 2 }),
      }),
      expect.objectContaining({
        label: "Silver jewelry",
        confidence: 0,
        scope: "global_style",
        permanence: "long_term",
        editable: true,
        status: "needs_review",
        provenance: { source: "explicit_edit", createdAt: now },
      }),
    ]));
    expect(profile.styleFeedback).toEqual([]);
    expect(profile.softPreferences.length).toBeGreaterThan(0);
  });

  it("records the counterbalanced presentation order without changing canonical A/B semantics", () => {
    const question = calibrationCatalogV2.questions[0];
    const response = createCalibrationResponse(question.id, "a", now, calibrationCatalogV2, ["b", "a"]);
    const profile = buildCalibrationPreferenceProfile({ direction: "neutral", responses: [response], now: now + 1 });

    expect(profile.calibrationResponses?.[0]).toMatchObject({ choice: "a", presentationOrder: ["b", "a"] });
    expect(profile.preferenceSignals?.find((signal) => signal.value === question.optionA.id)).toMatchObject({
      polarity: "more",
      provenance: { responseChoice: "a", presentationOrder: ["b", "a"] },
    });

    const aLeft = deriveCalibrationModel([
      createCalibrationResponse(question.id, "a", now, calibrationCatalogV2, ["a", "b"]),
    ], { now });
    const bLeft = deriveCalibrationModel([
      createCalibrationResponse(question.id, "a", now, calibrationCatalogV2, ["b", "a"]),
    ], { now });
    expect(bLeft.styleVector).toEqual(aLeft.styleVector);
    expect(bLeft.styleAnchors).toEqual(aLeft.styleAnchors);
    expect(bLeft.confidence).toEqual(aLeft.confidence);
    expect(bLeft.signals.map(({ value, polarity }) => ({ value, polarity })))
      .toEqual(aLeft.signals.map(({ value, polarity }) => ({ value, polarity })));
  });

  it("rejects unknown questions, wrong IDs, versions, and ambiguous duplicate edits", () => {
    expect(() => createCalibrationResponse("missing-question", "a", now)).toThrowError(
      expect.objectContaining<Partial<CalibrationContractError>>({ code: "UNKNOWN_QUESTION" }),
    );

    const valid = response(0, "a");
    expect(() => canonicalizeCalibrationResponses([{ ...valid, id: "wrong" }])).toThrowError(
      expect.objectContaining<Partial<CalibrationContractError>>({ code: "RESPONSE_ID_MISMATCH" }),
    );
    expect(() => canonicalizeCalibrationResponses([{ ...valid, catalogVersion: 999 }])).toThrowError(
      expect.objectContaining<Partial<CalibrationContractError>>({ code: "WRONG_CATALOG" }),
    );
    expect(() => canonicalizeCalibrationResponses([valid, { ...valid, choice: "b" }])).toThrowError(
      expect.objectContaining<Partial<CalibrationContractError>>({ code: "CONFLICTING_RESPONSE" }),
    );
  });

  it("provides an explicit edit operation instead of resolving conflicting arrays by order", () => {
    const first = response(0, "a");
    const edited = createCalibrationResponse(first.questionId, "neither", now + 10);
    expect(upsertCalibrationResponse([first], edited)).toEqual([edited]);
  });
});
