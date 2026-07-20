import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { applyPreferenceDelta, type PreferenceMutationSource } from "@/domain/preferences/profile-mutations";
import type { PreferenceDelta, PreferenceProfile } from "@/domain/schemas";
import { db } from "@/lib/storage/db";

/**
 * The single persistence boundary for structured preference tools. Dexie
 * serializes concurrent calls, and each call derives from the latest profile.
 */
export function persistPreferenceDelta(delta: PreferenceDelta, source: PreferenceMutationSource = "explicit_voice"): Promise<PreferenceProfile> {
  return db.transaction("rw", db.preferenceProfiles, async () => {
    const profile = (await db.preferenceProfiles.get("default")) ?? createNeutralPreferenceProfile();
    const updated = applyPreferenceDelta({ profile, delta, source });
    await db.preferenceProfiles.put(updated);
    return updated;
  });
}
