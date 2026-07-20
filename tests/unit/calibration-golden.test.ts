import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";
import { createCalibrationResponse, deriveCalibrationModel } from "@/domain/preferences/calibration-engine";
import type { CalibrationResponseChoice } from "@/domain/schemas";

type GoldenCalibration = {
  version: string;
  catalogVersion: number;
  scenarios: Array<{
    id: string;
    choices: CalibrationResponseChoice[];
    expected: { more: number; less: number; unknown: number; differentiation: number; overall: number };
  }>;
};

const golden = JSON.parse(readFileSync(join(process.cwd(), "tests/golden/calibration-v2.json"), "utf8")) as GoldenCalibration;

describe(`versioned calibration golden profiles: ${golden.version}`, () => {
  it("targets the shipped semantic catalog", () => {
    expect(golden.catalogVersion).toBe(calibrationCatalogV2.version);
    expect(golden.scenarios.map((scenario) => scenario.id)).toEqual([
      "all-both",
      "all-skip",
      "relative-winners",
      "explicit-neither",
    ]);
  });

  it.each(golden.scenarios)("$id preserves evidence polarity and confidence", ({ choices, expected }) => {
    const responses = choices.map((choice, index) => createCalibrationResponse(
      calibrationCatalogV2.questions[index].id,
      choice,
      1_750_000_000_000 + index,
    ));
    const model = deriveCalibrationModel(responses, { now: 1_750_000_000_100 });
    expect(model.signals.filter((signal) => signal.polarity === "more")).toHaveLength(expected.more);
    expect(model.signals.filter((signal) => signal.polarity === "less")).toHaveLength(expected.less);
    expect(model.signals.filter((signal) => signal.polarity === "unknown")).toHaveLength(expected.unknown);
    expect(model.confidence.differentiation).toBeCloseTo(expected.differentiation, 12);
    expect(model.confidence.overall).toBeCloseTo(expected.overall, 12);
  });
});
