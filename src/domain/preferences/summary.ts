import { activeLongTermPreferenceSignals } from "@/domain/preferences/profile-mutations";
import type { PreferenceProfile } from "@/domain/schemas";

function unique(values: string[]) {
  return [...new Map(values.map((value) => [value.toLocaleLowerCase("en-US"), value])).values()];
}

/**
 * A bounded model-facing summary of evidence that actually affects ranking.
 * Descriptive wardrobe metadata and review-only notes are intentionally absent.
 */
export function recommendationPreferenceSummary(profile: PreferenceProfile | undefined) {
  if (!profile) return "No saved long-term preferences.";
  if (profile.preferenceSignals !== undefined) {
    const active = activeLongTermPreferenceSignals(profile);
    const more = unique(active.filter((signal) => signal.polarity === "more").map((signal) => signal.label));
    const less = unique(active.filter((signal) => signal.polarity === "less").map((signal) => signal.label));
    return `Prefers ${more.join(", ") || "balanced looks"}. Avoids ${less.join(", ") || "nothing explicit"}.`;
  }
  const avoids = unique([...profile.hardAvoids, ...profile.softPreferences.filter((rule) => rule.polarity === "avoid")].map((rule) => rule.value));
  const prefers = unique(profile.softPreferences.filter((rule) => rule.polarity !== "avoid" && !rule.key.endsWith("note")).map((rule) => rule.value));
  return `Prefers ${prefers.join(", ") || "balanced looks"}. Avoids ${avoids.join(", ") || "nothing explicit"}.`;
}
