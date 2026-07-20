import { projectStyleSignals } from "@/domain/preferences/calibration-engine";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import {
  PreferenceDeltaSchema,
  PreferenceProfileSchema,
  PreferenceSignalSchema,
  type PreferenceDelta,
  type PreferenceProfile,
  type PreferenceSignal,
  type ProfileConfidence,
} from "@/domain/schemas";

export type PreferenceMutationSource = "explicit_voice" | "profile_edit" | "explicit_edit";

export class PreferenceMutationError extends Error {
  constructor(
    public readonly code: "INVALID_DELTA" | "SIGNAL_NOT_FOUND" | "SIGNAL_NOT_EDITABLE" | "SIGNAL_LIMIT_REACHED",
    message: string,
  ) {
    super(message);
    this.name = "PreferenceMutationError";
  }
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ");
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function uniqueNormalized(values: readonly string[]) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function signalIdentity(delta: PreferenceDelta) {
  return JSON.stringify({
    attribute: delta.attribute,
    value: normalize(delta.value ?? ""),
    scope: delta.scope,
    categories: [...new Set(delta.categories)].sort(),
    slots: [...new Set(delta.slots)].sort(),
    combinationValues: uniqueNormalized(delta.combinationValues).sort(),
  });
}

function calibrationConfidenceFromSignals(signals: readonly PreferenceSignal[]): ProfileConfidence {
  const semantic = signals.filter((signal) => signal.attribute === "style_look" && signal.semanticVector && signal.polarity !== "unknown");
  if (!semantic.length) return { evidence: 0, coverage: 0, differentiation: 0, overall: 0 };
  const byQuestion = new Map<string, PreferenceSignal[]>();
  for (const signal of semantic) {
    const questionId = signal.provenance.questionId;
    if (!questionId) continue;
    byQuestion.set(questionId, [...(byQuestion.get(questionId) ?? []), signal]);
  }
  const questionCount = byQuestion.size;
  if (!questionCount) return { evidence: 0, coverage: 0, differentiation: 0, overall: 0 };
  const evidence = questionCount / (questionCount + 3);
  const coverage = Math.min(1, questionCount / 6);
  const relative = [...byQuestion.values()].filter((questionSignals) => questionSignals.some((signal) => signal.scope === "relative_pair")).length / questionCount;
  const overall = Math.min(evidence * (0.35 + relative * 0.65) * (0.6 + coverage * 0.4), 0.82);
  return { evidence, coverage, differentiation: relative, overall };
}

function confidenceFromSignals(signals: readonly PreferenceSignal[]): ProfileConfidence {
  const calibration = calibrationConfidenceFromSignals(signals);
  const explicit = signals.filter((signal) => signal.attribute !== "style_look");
  if (!explicit.length) return calibration;
  const effectiveCount = explicit.reduce((sum, signal) => sum + signal.confidence, 0);
  const evidence = effectiveCount / (effectiveCount + 4);
  const coverage = new Set(explicit.map((signal) => signal.attribute)).size / 10;
  const directionalConfidence = effectiveCount / explicit.length;
  const explicitOverall = Math.min(0.72, evidence * (0.55 + directionalConfidence * 0.45) * (0.65 + coverage * 0.35));
  return {
    evidence: Math.max(calibration.evidence, evidence),
    coverage: Math.max(calibration.coverage, coverage),
    differentiation: calibration.differentiation,
    overall: Math.min(0.82, 1 - (1 - calibration.overall) * (1 - explicitOverall)),
  };
}

function compatibleRule(signal: PreferenceSignal) {
  return {
    key: signal.attribute,
    value: signal.attribute === "style_look" || signal.attribute === "preference_note" ? normalize(signal.label) : signal.value,
    strength: signal.strength,
    polarity: signal.polarity === "less" ? "avoid" as const : "prefer" as const,
  };
}

function labelsFor(signals: readonly PreferenceSignal[], polarity: "more" | "less") {
  const values = new Map<string, string>();
  for (const signal of signals) {
    if (signal.polarity !== polarity) continue;
    const key = normalize(signal.label);
    if (!values.has(key)) values.set(key, signal.label);
  }
  return [...values.values()].slice(0, 12);
}

/** Signals that are allowed to alter durable recommendation behavior. */
export function activeLongTermPreferenceSignals(profile: PreferenceProfile) {
  return (profile.preferenceSignals ?? []).filter((signal) => signal.status === "active"
    && signal.permanence !== "contextual"
    && signal.scope !== "contextual"
    && signal.polarity !== "unknown"
    && signal.confidence > 0);
}

type EffectiveStyleProjection = {
  styleVector: PreferenceProfile["styleVector"];
  styleAnchors: PreferenceProfile["styleAnchors"];
  confidence: ProfileConfidence | undefined;
};

const styleProjectionCache = new WeakMap<PreferenceProfile, EffectiveStyleProjection>();

/** Returns the only style vector/anchors canonical profiles are allowed to score. */
export function effectiveStyleProjection(profile: PreferenceProfile, now = profile.updatedAt): EffectiveStyleProjection {
  if (now === profile.updatedAt) {
    const cached = styleProjectionCache.get(profile);
    if (cached) return cached;
  }
  let projection: EffectiveStyleProjection;
  if (profile.preferenceSignals === undefined) {
    projection = { styleVector: profile.styleVector, styleAnchors: profile.styleAnchors, confidence: profile.profileConfidence };
  } else {
    const active = activeLongTermPreferenceSignals(profile);
    const confidence = confidenceFromSignals(active);
    const calibrationConfidence = calibrationConfidenceFromSignals(active);
    projection = { ...projectStyleSignals(active, calibrationConfidence, now), confidence };
  }
  if (now === profile.updatedAt) styleProjectionCache.set(profile, projection);
  return projection;
}

function boundedSignals(signals: readonly PreferenceSignal[]) {
  const parsed = signals.map((signal) => PreferenceSignalSchema.parse(signal));
  const byId = new Map<string, PreferenceSignal>();
  for (const signal of parsed) byId.set(signal.id, signal);
  const unique = [...byId.values()].sort((left, right) => left.provenance.createdAt - right.provenance.createdAt || left.id.localeCompare(right.id));
  if (unique.length <= 100) return unique;
  const durable = unique.filter((signal) => signal.status !== "deleted" && signal.permanence !== "contextual" && signal.scope !== "contextual");
  if (durable.length > 100) throw new PreferenceMutationError("SIGNAL_LIMIT_REACHED", "The preference profile has reached its active signal limit.");
  const contextual = unique.filter((signal) => signal.status !== "deleted" && (signal.permanence === "contextual" || signal.scope === "contextual"));
  const deleted = unique.filter((signal) => signal.status === "deleted");
  const available = 100 - durable.length;
  const retainedContextual = available > 0 ? contextual.slice(-available) : [];
  const deletedCapacity = available - retainedContextual.length;
  const retainedDeleted = deletedCapacity > 0 ? deleted.slice(-deletedCapacity) : [];
  return [...durable, ...retainedContextual, ...retainedDeleted]
    .sort((left, right) => left.provenance.createdAt - right.provenance.createdAt || left.id.localeCompare(right.id));
}

/**
 * Recomputes every compatibility projection from canonical signals. Raw notes
 * remain editable evidence, but cannot silently influence recommendation.
 */
export function rebuildProfileFromSignals(input: {
  profile: PreferenceProfile;
  signals?: PreferenceSignal[];
  now?: number;
}): PreferenceProfile {
  const now = input.now ?? Date.now();
  const source = input.profile.provenance === "demo" ? createNeutralPreferenceProfile(now) : input.profile;
  const signals = boundedSignals(input.signals ?? source.preferenceSignals ?? []);
  const projectionProfile = { ...source, preferenceSignals: signals } as PreferenceProfile;
  const active = activeLongTermPreferenceSignals(projectionProfile);
  const effectiveProjection = effectiveStyleProjection(projectionProfile, now);
  const confidence = effectiveProjection.confidence ?? { evidence: 0, coverage: 0, differentiation: 0, overall: 0 };
  const hardAvoids = active.filter((signal) => signal.strength === "hard" && signal.polarity === "less").map(compatibleRule);
  const softPreferences = active.filter((signal) => signal.strength === "soft").map(compatibleRule);
  const preferredMetals = active
    .filter((signal) => signal.attribute === "metal" && signal.polarity === "more")
    .map((signal) => normalize(signal.value))
    .filter((value): value is "gold" | "silver" | "mixed" => value === "gold" || value === "silver" || value === "mixed");

  return PreferenceProfileSchema.parse({
    ...source,
    schemaVersion: 2,
    origin: source.origin === "neutral" ? "edited" : source.origin ?? "edited",
    preferenceSignals: signals,
    profileConfidence: confidence,
    styleVector: effectiveProjection.styleVector,
    styleAnchors: effectiveProjection.styleAnchors,
    hardAvoids,
    softPreferences,
    preferredMetals,
    preferenceNotes: {
      moreOf: labelsFor(active, "more"),
      lessOf: labelsFor(active, "less"),
      freeform: source.preferenceNotes.freeform,
    },
    provenance: "personal",
    updatedAt: now,
  });
}

function signalFromDelta(delta: PreferenceDelta, id: string, now: number, source: PreferenceMutationSource): PreferenceSignal {
  return PreferenceSignalSchema.parse({
    id,
    attribute: delta.attribute,
    value: normalize(delta.value ?? ""),
    label: delta.label,
    polarity: delta.polarity,
    strength: delta.strength,
    confidence: delta.confidence,
    scope: delta.scope,
    categories: [...new Set(delta.categories)],
    slots: [...new Set(delta.slots)],
    permanence: "long_term",
    editable: true,
    status: delta.needsReview || delta.attribute === "preference_note" ? "needs_review" : "active",
    combinationValues: uniqueNormalized(delta.combinationValues),
    styleTags: [],
    provenance: { source, sourceId: id, createdAt: now },
  });
}

export function applyPreferenceDelta(input: {
  profile: PreferenceProfile;
  delta: PreferenceDelta;
  now?: number;
  source?: PreferenceMutationSource;
}): PreferenceProfile {
  const parsed = PreferenceDeltaSchema.safeParse(input.delta);
  if (!parsed.success) throw new PreferenceMutationError("INVALID_DELTA", "The preference update was not valid.");
  if (parsed.data.action === "remove") {
    return removePreferenceSignal({ profile: input.profile, signalId: parsed.data.signalId!, now: input.now, source: input.source });
  }

  const now = input.now ?? Date.now();
  const base = input.profile.provenance === "demo" ? createNeutralPreferenceProfile(now) : input.profile;
  const existingSignals = base.preferenceSignals ?? [];
  const generatedId = `preference:${stableHash(signalIdentity(parsed.data))}`;
  const id = parsed.data.signalId ?? generatedId;
  const existing = existingSignals.find((signal) => signal.id === id);
  if (parsed.data.signalId && !existing) throw new PreferenceMutationError("SIGNAL_NOT_FOUND", "The preference being edited no longer exists.");
  if (existing && !existing.editable) throw new PreferenceMutationError("SIGNAL_NOT_EDITABLE", "This preference cannot be edited.");
  const next = signalFromDelta(parsed.data, id, now, input.source ?? "explicit_edit");
  const signals = [...existingSignals.filter((signal) => signal.id !== id && signal.id !== generatedId), next];
  const evidenceSource = input.source ?? "explicit_edit";
  const evidence = parsed.data.evidenceSummary
    ? [...base.evidence.filter((entry) => !(entry.source === evidenceSource && entry.phrase === parsed.data.evidenceSummary)), { phrase: parsed.data.evidenceSummary, source: evidenceSource, createdAt: now }].slice(-100)
    : base.evidence;
  return PreferenceProfileSchema.parse({
    ...rebuildProfileFromSignals({ profile: { ...base, evidence }, signals, now }),
    revision: (base.revision ?? 0) + 1,
  });
}

export function removePreferenceSignal(input: {
  profile: PreferenceProfile;
  signalId: string;
  now?: number;
  source?: PreferenceMutationSource;
}): PreferenceProfile {
  const now = input.now ?? Date.now();
  const existingSignals = input.profile.preferenceSignals ?? [];
  const existing = existingSignals.find((signal) => signal.id === input.signalId);
  if (!existing) throw new PreferenceMutationError("SIGNAL_NOT_FOUND", "The preference being removed no longer exists.");
  if (!existing.editable) throw new PreferenceMutationError("SIGNAL_NOT_EDITABLE", "This preference cannot be removed.");
  if (existing.status === "deleted") return input.profile;
  const tombstone = PreferenceSignalSchema.parse({
    ...existing,
    status: "deleted",
  });
  const relatedConfirmationEvidence = existing.provenance.source === "confirmation" && existing.permanence === "long_term"
    ? existingSignals.filter((signal) => signal.provenance.source === "confirmation"
      && signal.permanence === "contextual"
      && signal.attribute === existing.attribute
      && signal.value === existing.value)
    : [];
  const relatedIds = new Set(relatedConfirmationEvidence.map((signal) => signal.id));
  const relatedTombstones = relatedConfirmationEvidence.map((signal) => PreferenceSignalSchema.parse({ ...signal, status: "deleted" }));
  const removalEvidence = { phrase: `Removed preference: ${existing.label}`.slice(0, 200), source: input.source ?? "profile_edit", createdAt: now };
  return PreferenceProfileSchema.parse({
    ...rebuildProfileFromSignals({
      profile: { ...input.profile, evidence: [...input.profile.evidence, removalEvidence].slice(-100) },
      signals: [...existingSignals.filter((signal) => signal.id !== input.signalId && !relatedIds.has(signal.id)), ...relatedTombstones, tombstone],
      now,
    }),
    revision: (input.profile.revision ?? 0) + 1,
  });
}
