import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";
import {
  buildCalibrationPreferenceProfile,
  canonicalizeCalibrationResponses,
  createCalibrationResponse,
  deriveCalibrationModel,
} from "@/domain/preferences/calibration-engine";
import type { CalibrationResponseChoice } from "@/domain/schemas";

const choices = ["a", "b", "both", "neither", "skip"] as const satisfies readonly CalibrationResponseChoice[];
const choiceArbitrary = fc.constantFrom(...choices);
const now = 1_750_000_000_000;

function responsesFor(values: CalibrationResponseChoice[]) {
  return values.map((choice, index) => createCalibrationResponse(calibrationCatalogV2.questions[index].id, choice, now + index));
}

describe("calibration invariants", () => {
  it("keeps every vector axis and confidence component bounded", () => {
    fc.assert(fc.property(fc.array(choiceArbitrary, { minLength: 0, maxLength: 6 }), (values) => {
      const model = deriveCalibrationModel(responsesFor(values), { now });
      for (const value of Object.values(model.styleVector)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
      for (const value of Object.values(model.confidence)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }), { numRuns: 150 });
  });

  it("is independent of response order", () => {
    fc.assert(fc.property(
      fc.array(choiceArbitrary, { minLength: 0, maxLength: 6 }),
      fc.integer({ min: 0, max: 100_000 }),
      (values, seed) => {
        const responses = responsesFor(values);
        const shuffled = fc.sample(fc.shuffledSubarray(responses, { minLength: responses.length, maxLength: responses.length }), { seed, numRuns: 1 })[0];
        expect(deriveCalibrationModel(shuffled, { now })).toEqual(deriveCalibrationModel(responses, { now }));
      },
    ), { numRuns: 100 });
  });

  it("is idempotent under repeated identical responses", () => {
    fc.assert(fc.property(fc.array(choiceArbitrary, { minLength: 0, maxLength: 6 }), (values) => {
      const responses = responsesFor(values);
      const repeated = responses.flatMap((response) => [response, { ...response, createdAt: response.createdAt + 500 }]);
      expect(canonicalizeCalibrationResponses(repeated)).toEqual(canonicalizeCalibrationResponses(responses));
      expect(deriveCalibrationModel(repeated, { now })).toEqual(deriveCalibrationModel(responses, { now }));
    }), { numRuns: 100 });
  });

  it("never turns a relative loser, Both, or Skip into negative evidence", () => {
    const nonNegativeChoice = fc.constantFrom("a", "b", "both", "skip") as fc.Arbitrary<CalibrationResponseChoice>;
    fc.assert(fc.property(fc.array(nonNegativeChoice, { minLength: 0, maxLength: 6 }), (values) => {
      const profile = buildCalibrationPreferenceProfile({ direction: "neutral", responses: responsesFor(values), now });
      expect(profile.preferenceSignals?.some((signal) => signal.polarity === "less")).toBe(false);
      expect(profile.preferenceNotes.lessOf).toEqual([]);
      expect(profile.softPreferences.some((rule) => rule.polarity === "avoid")).toBe(false);
    }), { numRuns: 100 });
  });
});
