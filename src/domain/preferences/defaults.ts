import { PreferenceProfileSchema, type PreferenceProfile } from "@/domain/schemas";

export function createNeutralPreferenceProfile(now = Date.now()): PreferenceProfile {
  return PreferenceProfileSchema.parse({
    id: "default",
    styleVector: {
      relaxedPolished: 0,
      minimalExpressive: 0,
      softCool: 0,
      fittedOversized: 0,
      classicTrendAware: 0,
      feminineNeutral: 0,
    },
    hardAvoids: [],
    softPreferences: [],
    preferredMetals: [],
    comfortWeight: 0.5,
    formalityBias: 0,
    evidence: [],
    updatedAt: now,
  });
}
