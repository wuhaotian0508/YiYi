import {
  CalibrationResponseSchema,
  PreferenceProfileSchema,
  PreferenceSignalSchema,
  type CalibrationResponse,
  type CalibrationResponseChoice,
  type CalibrationPresentationOrder,
  type PreferenceProfile,
  type PreferenceSignal,
  type ProfileConfidence,
  type StyleAnchor,
  type StyleVector,
  type WardrobeDirection,
} from "@/domain/schemas";
import {
  calibrationCatalogV2,
  getCalibrationQuestion,
  type CalibrationCatalog,
  type CalibrationOption,
  type CalibrationQuestion,
} from "@/domain/preferences/calibration-catalog";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";

const axes: (keyof StyleVector)[] = [
  "relaxedPolished",
  "minimalExpressive",
  "softCool",
  "fittedOversized",
  "classicTrendAware",
  "feminineNeutral",
];

const zeroVector: StyleVector = {
  relaxedPolished: 0,
  minimalExpressive: 0,
  softCool: 0,
  fittedOversized: 0,
  classicTrendAware: 0,
  feminineNeutral: 0,
};

export type CalibrationContractErrorCode =
  | "INVALID_RESPONSE"
  | "WRONG_CATALOG"
  | "UNKNOWN_QUESTION"
  | "RESPONSE_ID_MISMATCH"
  | "CONFLICTING_RESPONSE";

export class CalibrationContractError extends Error {
  readonly code: CalibrationContractErrorCode;

  constructor(code: CalibrationContractErrorCode, message: string) {
    super(message);
    this.name = "CalibrationContractError";
    this.code = code;
  }
}

export type CalibrationModel = {
  responses: CalibrationResponse[];
  signals: PreferenceSignal[];
  styleVector: StyleVector;
  styleAnchors: StyleAnchor[];
  confidence: ProfileConfidence;
};

export type BuildCalibrationPreferenceProfileInput = {
  direction: WardrobeDirection;
  responses: CalibrationResponse[];
  moreOf?: string[];
  lessOf?: string[];
  freeform?: string;
  now?: number;
  revision?: number;
  catalog?: CalibrationCatalog;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampAxis(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function responseId(questionId: string, catalog: CalibrationCatalog) {
  return `${catalog.id}:v${catalog.version}:${questionId}`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizedNotes(values: string[] | undefined) {
  const byKey = new Map<string, string>();
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const bounded = trimmed.slice(0, 80);
    const key = bounded.toLocaleLowerCase("en-US");
    if (!byKey.has(key)) byKey.set(key, bounded);
  }
  return [...byKey.values()].slice(0, 12);
}

export function createCalibrationResponse(
  questionId: string,
  choice: CalibrationResponseChoice,
  createdAt = Date.now(),
  catalog: CalibrationCatalog = calibrationCatalogV2,
  presentationOrder: CalibrationPresentationOrder = ["a", "b"],
): CalibrationResponse {
  if (!getCalibrationQuestion(questionId, catalog)) {
    throw new CalibrationContractError("UNKNOWN_QUESTION", `Unknown calibration question: ${questionId}`);
  }
  return CalibrationResponseSchema.parse({
    id: responseId(questionId, catalog),
    catalogId: catalog.id,
    catalogVersion: catalog.version,
    questionId,
    choice,
    presentationOrder,
    createdAt,
  });
}

export function canonicalizeCalibrationResponses(
  input: readonly CalibrationResponse[],
  catalog: CalibrationCatalog = calibrationCatalogV2,
): CalibrationResponse[] {
  const byQuestion = new Map<string, CalibrationResponse>();

  for (const raw of input) {
    const parsed = CalibrationResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CalibrationContractError("INVALID_RESPONSE", "Calibration response did not match the canonical schema.");
    }
    const response = parsed.data;
    if (response.catalogId !== catalog.id || response.catalogVersion !== catalog.version) {
      throw new CalibrationContractError("WRONG_CATALOG", `Response ${response.id} belongs to a different calibration catalog.`);
    }
    if (!getCalibrationQuestion(response.questionId, catalog)) {
      throw new CalibrationContractError("UNKNOWN_QUESTION", `Unknown calibration question: ${response.questionId}`);
    }
    if (response.id !== responseId(response.questionId, catalog)) {
      throw new CalibrationContractError("RESPONSE_ID_MISMATCH", `Response ID does not match question ${response.questionId}.`);
    }

    const existing = byQuestion.get(response.questionId);
    if (existing && existing.choice !== response.choice) {
      throw new CalibrationContractError("CONFLICTING_RESPONSE", `Question ${response.questionId} has conflicting responses.`);
    }
    // Exact repeats are idempotent. Choosing the earliest provenance timestamp
    // also makes canonicalization independent of input ordering.
    if (!existing || response.createdAt < existing.createdAt) byQuestion.set(response.questionId, response);
  }

  return catalog.questions.flatMap((question) => {
    const response = byQuestion.get(question.id);
    return response ? [response] : [];
  });
}

export function upsertCalibrationResponse(
  existing: readonly CalibrationResponse[],
  next: CalibrationResponse,
  catalog: CalibrationCatalog = calibrationCatalogV2,
) {
  const parsedNext = canonicalizeCalibrationResponses([next], catalog)[0];
  return canonicalizeCalibrationResponses([
    ...existing.filter((response) => response.questionId !== parsedNext.questionId),
    parsedNext,
  ], catalog);
}

function signalForOption(input: {
  question: CalibrationQuestion;
  option: CalibrationOption;
  response: CalibrationResponse;
  polarity: PreferenceSignal["polarity"];
  confidence: number;
  scope: PreferenceSignal["scope"];
}): PreferenceSignal {
  return PreferenceSignalSchema.parse({
    id: `calibration:${input.question.id}:${input.option.id}:${input.polarity}`,
    attribute: "style_look",
    value: input.option.id,
    label: input.option.label,
    polarity: input.polarity,
    strength: "soft",
    confidence: clamp01(input.confidence),
    scope: input.scope,
    permanence: "onboarding_seed",
    editable: true,
    semanticVector: input.option.vector,
    styleTags: input.option.styleTags,
    provenance: {
      source: "calibration_pairwise",
      catalogId: input.response.catalogId,
      catalogVersion: input.response.catalogVersion,
      questionId: input.question.id,
      optionId: input.option.id,
      responseChoice: input.response.choice,
      presentationOrder: input.response.presentationOrder,
      createdAt: input.response.createdAt,
    },
  });
}

function signalsForResponse(response: CalibrationResponse, question: CalibrationQuestion) {
  const common = { question, response };
  switch (response.choice) {
    case "a":
      return [
        signalForOption({ ...common, option: question.optionA, polarity: "more", confidence: 0.62, scope: "relative_pair" }),
        signalForOption({ ...common, option: question.optionB, polarity: "unknown", confidence: 0, scope: "relative_pair" }),
      ];
    case "b":
      return [
        signalForOption({ ...common, option: question.optionA, polarity: "unknown", confidence: 0, scope: "relative_pair" }),
        signalForOption({ ...common, option: question.optionB, polarity: "more", confidence: 0.62, scope: "relative_pair" }),
      ];
    case "both":
      return [
        signalForOption({ ...common, option: question.optionA, polarity: "more", confidence: 0.42, scope: "global_style" }),
        signalForOption({ ...common, option: question.optionB, polarity: "more", confidence: 0.42, scope: "global_style" }),
      ];
    case "neither":
      return [
        signalForOption({ ...common, option: question.optionA, polarity: "less", confidence: 0.48, scope: "global_style" }),
        signalForOption({ ...common, option: question.optionB, polarity: "less", confidence: 0.48, scope: "global_style" }),
      ];
    case "skip":
      return [];
  }
}

function profileConfidence(responses: readonly CalibrationResponse[], questionCount: number): ProfileConfidence {
  const active = responses.filter((response) => response.choice !== "skip");
  if (active.length === 0) return { evidence: 0, coverage: 0, differentiation: 0, overall: 0 };

  // Three pseudo-observations keep a short onboarding from pretending it has
  // learned a certain long-term profile.
  const evidence = active.length / (active.length + 3);
  const coverage = active.length / Math.max(1, questionCount);
  const differentiation = active.filter((response) => response.choice === "a" || response.choice === "b").length / active.length;
  const overall = evidence * (0.35 + 0.65 * differentiation) * (0.6 + 0.4 * coverage);
  return {
    evidence: clamp01(evidence),
    coverage: clamp01(coverage),
    differentiation: clamp01(differentiation),
    overall: clamp01(Math.min(0.82, overall)),
  };
}

function vectorFromSignals(signals: readonly PreferenceSignal[], confidence: ProfileConfidence): StyleVector {
  const vector = { ...zeroVector };
  for (const axis of axes) {
    let weighted = 0;
    let observedWeight = 0;
    for (const signal of signals) {
      // A rejected full look is not evidence for the mathematical opposite
      // of that look. Negative calibration signals are scored as bounded
      // outfit-level penalties instead; only positive evidence defines the
      // directional style projection.
      if (signal.polarity !== "more" || !signal.semanticVector) continue;
      const axisValue = signal.semanticVector[axis];
      if (axisValue === 0) continue;
      weighted += axisValue * signal.confidence;
      observedWeight += signal.confidence;
    }
    const observed = observedWeight > 0 ? weighted / observedWeight : 0;
    vector[axis] = clampAxis(observed * confidence.overall);
  }
  return vector;
}

function anchorsFromSignals(signals: readonly PreferenceSignal[], now: number): StyleAnchor[] {
  return signals
    .filter((signal): signal is PreferenceSignal & { semanticVector: StyleVector } => signal.polarity === "more" && Boolean(signal.semanticVector))
    .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
    .slice(0, 4)
    .map((signal) => ({
      id: `pair-${signal.value}`,
      label: signal.label,
      vector: signal.semanticVector,
      styleTags: Object.fromEntries(signal.styleTags.map((tag) => [tag, signal.confidence])),
      evidenceCount: 1,
      confidence: signal.confidence,
      updatedAt: now,
    }));
}

/**
 * Rebuilds the derived style projection from canonical evidence. Callers must
 * pass only signals that are allowed to influence the long-term profile.
 * Keeping this projection in one place prevents deleted or review-only
 * evidence from surviving in styleVector/styleAnchors.
 */
export function projectStyleSignals(
  signals: readonly PreferenceSignal[],
  confidence: ProfileConfidence,
  now = Date.now(),
) {
  const semanticSignals = signals.filter((signal) => signal.attribute === "style_look" && Boolean(signal.semanticVector));
  return {
    styleVector: vectorFromSignals(semanticSignals, confidence),
    styleAnchors: anchorsFromSignals(semanticSignals, now),
  };
}

function explicitNoteSignals(input: { moreOf: string[]; lessOf: string[]; now: number }): PreferenceSignal[] {
  return [
    ...input.moreOf.map((label) => ({ label, polarity: "more" as const })),
    ...input.lessOf.map((label) => ({ label, polarity: "less" as const })),
  ].map(({ label, polarity }) => PreferenceSignalSchema.parse({
    id: `explicit:${polarity}:${stableHash(label.toLocaleLowerCase("en-US"))}`,
    attribute: "preference_note",
    value: label.toLocaleLowerCase("en-US"),
    label,
    polarity,
    strength: "soft",
    confidence: 0,
    scope: "global_style",
    permanence: "long_term",
    editable: true,
    status: "needs_review",
    styleTags: [],
    provenance: { source: "explicit_edit", createdAt: input.now },
  }));
}

export function deriveCalibrationModel(
  input: readonly CalibrationResponse[],
  options: { catalog?: CalibrationCatalog; now?: number } = {},
): CalibrationModel {
  const catalog = options.catalog ?? calibrationCatalogV2;
  const now = options.now ?? Date.now();
  const responses = canonicalizeCalibrationResponses(input, catalog);
  const signals = responses.flatMap((response) => {
    const question = getCalibrationQuestion(response.questionId, catalog);
    if (!question) throw new CalibrationContractError("UNKNOWN_QUESTION", `Unknown calibration question: ${response.questionId}`);
    return signalsForResponse(response, question);
  });
  const confidence = profileConfidence(responses, catalog.questions.length);
  return {
    responses,
    signals,
    styleVector: vectorFromSignals(signals, confidence),
    styleAnchors: anchorsFromSignals(signals, now),
    confidence,
  };
}

export function buildCalibrationPreferenceProfile(input: BuildCalibrationPreferenceProfileInput): PreferenceProfile {
  const now = input.now ?? Date.now();
  const model = deriveCalibrationModel(input.responses, { catalog: input.catalog, now });
  const explicitMore = normalizedNotes(input.moreOf);
  const explicitLess = normalizedNotes(input.lessOf);
  const explicitSignals = explicitNoteSignals({ moreOf: explicitMore, lessOf: explicitLess, now });
  const signals = [...model.signals, ...explicitSignals];
  // Explicit edits remain visible even when a broad "Both" sequence fills all
  // twelve legacy note slots. Canonical signals retain the complete evidence.
  const moreOf = normalizedNotes([
    ...explicitMore,
    ...model.signals.filter((signal) => signal.polarity === "more").map((signal) => signal.label),
  ]);
  const lessOf = normalizedNotes([
    ...explicitLess,
    ...model.signals.filter((signal) => signal.polarity === "less").map((signal) => signal.label),
  ]);
  const neutral = createNeutralPreferenceProfile(now);

  return PreferenceProfileSchema.parse({
    ...neutral,
    schemaVersion: 2,
    origin: "calibration",
    revision: input.revision ?? 1,
    wardrobeDirection: input.direction,
    styleVector: model.styleVector,
    styleFeedback: [],
    calibrationResponses: model.responses,
    preferenceSignals: signals,
    profileConfidence: model.confidence,
    styleAnchors: model.styleAnchors,
    hardAvoids: [],
    softPreferences: signals
      .filter((signal) => signal.polarity !== "unknown" && signal.status === "active")
      .map((signal) => ({
        key: signal.attribute === "style_look" ? "calibration" : "explicit-edit",
        value: signal.label.toLocaleLowerCase("en-US"),
        strength: "soft" as const,
        polarity: signal.polarity === "less" ? "avoid" as const : "prefer" as const,
      })),
    preferenceNotes: { moreOf, lessOf, freeform: (input.freeform ?? "").trim().slice(0, 400) },
    evidence: input.freeform?.trim()
      ? [{ phrase: input.freeform.trim().slice(0, 200), source: "onboarding" as const, createdAt: now }]
      : [],
    provenance: "personal",
    updatedAt: now,
  });
}
