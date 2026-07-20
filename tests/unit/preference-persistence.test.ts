import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { preferenceDeltaForOption } from "@/domain/preferences/explicit-options";
import { applyPreferenceDelta } from "@/domain/preferences/profile-mutations";
import { PreferenceDeltaSchema } from "@/domain/schemas";
import { persistPreferenceDelta } from "@/lib/preferences/profile-storage";
import { db } from "@/lib/storage/db";

describe("preference persistence", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.preferenceProfiles.put(createNeutralPreferenceProfile(1));
  });

  afterEach(async () => { await db.delete(); });

  it("serializes simultaneous structured tool writes without losing either signal", async () => {
    await Promise.all([
      persistPreferenceDelta(preferenceDeltaForOption("more-relaxed"), "explicit_voice"),
      persistPreferenceDelta(preferenceDeltaForOption("less-formal"), "explicit_voice"),
    ]);

    const profile = await db.preferenceProfiles.get("default");
    const active = profile?.preferenceSignals?.filter((signal) => signal.status === "active").map((signal) => signal.label);
    expect(active).toEqual(expect.arrayContaining(["Relaxed tailoring", "Formal looks"]));
  });

  it("serializes an explicit delete with simultaneous chip and voice additions", async () => {
    const existing = applyPreferenceDelta({
      profile: createNeutralPreferenceProfile(1),
      delta: preferenceDeltaForOption("more-relaxed"),
      source: "profile_edit",
      now: 2,
    });
    const existingId = existing.preferenceSignals?.find((signal) => signal.label === "Relaxed tailoring")?.id;
    expect(existingId).toBeTruthy();
    await db.preferenceProfiles.put(existing);

    const remove = PreferenceDeltaSchema.parse({
      action: "remove",
      signalId: existingId,
      attribute: null,
      value: null,
      label: null,
      polarity: null,
      strength: "soft",
      scope: "global_style",
      categories: [],
      slots: [],
      combinationValues: [],
      confidence: 1,
      needsReview: false,
      evidenceSummary: null,
    });

    await Promise.all([
      persistPreferenceDelta(preferenceDeltaForOption("more-clean"), "profile_edit"),
      persistPreferenceDelta(remove, "profile_edit"),
      persistPreferenceDelta(preferenceDeltaForOption("less-formal"), "explicit_voice"),
    ]);

    const profile = await db.preferenceProfiles.get("default");
    expect(profile?.preferenceSignals?.find((signal) => signal.id === existingId)?.status).toBe("deleted");
    const active = profile?.preferenceSignals?.filter((signal) => signal.status === "active").map((signal) => signal.label);
    expect(active).toEqual(expect.arrayContaining(["Clean layers", "Formal looks"]));
    expect(profile?.preferenceNotes.moreOf).toEqual(["Clean layers"]);
    expect(profile?.preferenceNotes.lessOf).toEqual(["Formal looks"]);
  });
});
