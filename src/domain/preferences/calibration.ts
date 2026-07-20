import { PreferenceProfileSchema, type PreferenceProfile, type StyleFeedback, type StyleVector, type WardrobeDirection } from "@/domain/schemas";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { buildCalibrationPreferenceProfile, type BuildCalibrationPreferenceProfileInput } from "@/domain/preferences/calibration-engine";

export {
  CalibrationContractError,
  buildCalibrationPreferenceProfile,
  canonicalizeCalibrationResponses,
  createCalibrationResponse,
  deriveCalibrationModel,
  upsertCalibrationResponse,
} from "@/domain/preferences/calibration-engine";
export { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";

type CalibrationSemantics = { label: string; vector: StyleVector; styleTags: string[] };

export const calibrationLookSemantics: Record<string, CalibrationSemantics> = {
  "look-1": { label: "Relaxed minimal", vector: { relaxedPolished: -0.65, minimalExpressive: -0.7, softCool: 0.05, fittedOversized: 0.35, classicTrendAware: -0.15, feminineNeutral: 0.45 }, styleTags: ["relaxed", "minimal", "neutral", "clean"] },
  "look-2": { label: "Relaxed tailoring", vector: { relaxedPolished: 0.5, minimalExpressive: -0.45, softCool: 0.1, fittedOversized: 0.25, classicTrendAware: -0.2, feminineNeutral: 0.45 }, styleTags: ["tailored", "polished", "clean", "relaxed"] },
  "look-3": { label: "Sporty utility", vector: { relaxedPolished: -0.7, minimalExpressive: 0.05, softCool: 0.45, fittedOversized: 0.45, classicTrendAware: 0.25, feminineNeutral: 0.7 }, styleTags: ["sporty", "utility", "casual", "cool"] },
  "look-4": { label: "Soft layers", vector: { relaxedPolished: -0.35, minimalExpressive: -0.2, softCool: -0.7, fittedOversized: 0.5, classicTrendAware: -0.25, feminineNeutral: -0.15 }, styleTags: ["soft", "layered", "cozy", "relaxed"] },
  "look-5": { label: "Expressive color", vector: { relaxedPolished: 0.05, minimalExpressive: 0.8, softCool: 0.1, fittedOversized: 0.1, classicTrendAware: 0.55, feminineNeutral: 0.05 }, styleTags: ["expressive", "colorful", "modern", "statement"] },
  "look-6": { label: "Classic evening", vector: { relaxedPolished: 0.75, minimalExpressive: 0.05, softCool: -0.05, fittedOversized: -0.25, classicTrendAware: -0.65, feminineNeutral: -0.15 }, styleTags: ["classic", "evening", "polished", "refined"] },
};

const axes: (keyof StyleVector)[] = ["relaxedPolished", "minimalExpressive", "softCool", "fittedOversized", "classicTrendAware", "feminineNeutral"];

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value));
}

type LegacyCalibrationInput = {
  direction: WardrobeDirection;
  feedback: StyleFeedback[];
  moreOf: string[];
  lessOf: string[];
  freeform: string;
  now?: number;
};

export function buildPreferenceProfile(input: LegacyCalibrationInput): PreferenceProfile;
export function buildPreferenceProfile(input: BuildCalibrationPreferenceProfileInput): PreferenceProfile;
export function buildPreferenceProfile(input: LegacyCalibrationInput | BuildCalibrationPreferenceProfileInput): PreferenceProfile {
  if ("responses" in input) return buildCalibrationPreferenceProfile(input);
  const now = input.now ?? Date.now();
  const neutral = createNeutralPreferenceProfile(now);
  const evidence = input.feedback.filter((entry) => entry.sentiment !== "skip");
  const confidence = Math.min(0.8, evidence.length / 7);
  const vector = { ...neutral.styleVector };
  for (const axis of axes) {
    const observed = evidence.reduce((sum, entry) => {
      const semantics = calibrationLookSemantics[entry.lookId];
      if (!semantics) return sum;
      return sum + semantics.vector[axis] * (entry.sentiment === "like" ? 1 : -0.75);
    }, 0) / Math.max(1, evidence.length);
    vector[axis] = clamp(observed * confidence);
  }
  const liked = input.feedback.filter((entry) => entry.sentiment === "like").slice(0, 4);
  const styleAnchors = liked.flatMap((entry, index) => {
    const semantics = calibrationLookSemantics[entry.lookId];
    if (!semantics) return [];
    return [{
      id: `calibration-${index + 1}-${entry.lookId}`,
      label: semantics.label,
      vector: semantics.vector,
      styleTags: Object.fromEntries(semantics.styleTags.map((tag) => [tag, 0.75])),
      evidenceCount: 1,
      confidence: 0.35,
      updatedAt: now,
    }];
  });
  if (styleAnchors[0]) {
    styleAnchors[0] = {
      ...styleAnchors[0],
      styleTags: { ...styleAnchors[0].styleTags, ...Object.fromEntries(input.moreOf.map((value) => [value.toLowerCase(), 0.65])) },
      confidence: Math.min(0.65, styleAnchors[0].confidence + input.moreOf.length * 0.05),
    };
  }
  return PreferenceProfileSchema.parse({
    ...neutral,
    wardrobeDirection: input.direction,
    styleFeedback: input.feedback,
    styleAnchors,
    styleVector: vector,
    hardAvoids: [],
    softPreferences: [
      ...input.moreOf.map((value) => ({ key: "onboarding", value: value.toLowerCase(), strength: "soft" as const, polarity: "prefer" as const })),
      ...input.lessOf.map((value) => ({ key: "onboarding", value: value.toLowerCase(), strength: "soft" as const, polarity: "avoid" as const })),
    ],
    preferenceNotes: { moreOf: input.moreOf, lessOf: input.lessOf, freeform: input.freeform },
    evidence: input.freeform ? [{ phrase: input.freeform, source: "onboarding" as const, createdAt: now }] : [],
    provenance: "personal",
    updatedAt: now,
  });
}
