import { PreferenceProfileSchema, type PreferenceProfile } from "@/domain/schemas";

export function createNeutralPreferenceProfile(now = Date.now()): PreferenceProfile {
  return PreferenceProfileSchema.parse({
    id: "default",
    schemaVersion: 2,
    origin: "neutral",
    revision: 0,
    wardrobeDirection: "neutral",
    styleVector: {
      relaxedPolished: 0,
      minimalExpressive: 0,
      softCool: 0,
      fittedOversized: 0,
      classicTrendAware: 0,
      feminineNeutral: 0,
    },
    styleFeedback: [],
    calibrationResponses: [],
    preferenceSignals: [],
    profileConfidence: { evidence: 0, coverage: 0, differentiation: 0, overall: 0 },
    styleAnchors: [],
    hardAvoids: [],
    softPreferences: [],
    preferenceNotes: { moreOf: [], lessOf: [], freeform: "" },
    preferredMetals: [],
    comfortWeight: 0.5,
    formalityBias: 0,
    evidence: [],
    provenance: "personal",
    updatedAt: now,
  });
}
