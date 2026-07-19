import { PreferenceProfileSchema, type PreferenceProfile } from "@/domain/schemas";

export function createNeutralPreferenceProfile(now = Date.now()): PreferenceProfile {
  return PreferenceProfileSchema.parse({
    id: "default",
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
