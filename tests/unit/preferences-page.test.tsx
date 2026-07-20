import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PreferencesPage from "@/app/preferences/page";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { preferenceDeltaForOption } from "@/domain/preferences/explicit-options";
import { applyPreferenceDelta } from "@/domain/preferences/profile-mutations";
import { db } from "@/lib/storage/db";
import { demoPreferenceProfile } from "@/mocks/wardrobe";

describe("PreferencesPage canonical memory", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await db.delete();
  });

  it("seeds a neutral profile when experience mode is not known", async () => {
    render(<PreferencesPage />);
    expect(await screen.findByText("What YiYi remembers")).toBeVisible();
    await waitFor(async () => expect(await db.preferenceProfiles.get("default")).toMatchObject({ provenance: "personal", preferredMetals: [] }));
    expect(screen.queryByText(/silver-tone jewelry/i)).not.toBeInTheDocument();
  });

  it("labels canned Demo preferences as example data", async () => {
    await db.appSettings.put({ key: "experienceMode", value: "demo" });
    await db.preferenceProfiles.put(demoPreferenceProfile);
    render(<PreferencesPage />);
    expect(await screen.findByText(/Example preferences for the demo wardrobe/)).toBeVisible();
  });

  it("resets personal calibration evidence to neutral even while using the demo wardrobe", async () => {
    await db.appSettings.put({ key: "experienceMode", value: "demo" });
    const personal = applyPreferenceDelta({
      profile: createNeutralPreferenceProfile(1),
      delta: preferenceDeltaForOption("less-heels"),
      source: "profile_edit",
      now: 2,
    });
    await db.preferenceProfiles.put(personal);
    render(<PreferencesPage />);

    expect(await screen.findByText("Heels")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reset preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(async () => {
      const reset = await db.preferenceProfiles.get("default");
      expect(reset).toMatchObject({ origin: "neutral", provenance: "personal", wardrobeDirection: "neutral" });
      expect(reset?.preferenceSignals).toEqual([]);
      expect(reset?.preferenceNotes).toEqual({ moreOf: [], lessOf: [], freeform: "" });
    });
    expect(screen.queryByText(/Example preferences for the demo wardrobe/)).not.toBeInTheDocument();
    expect(screen.queryByText(/silver-tone jewelry/i)).not.toBeInTheDocument();
  });

  it("deletes a canonical signal by stable ID and removes its projected More of memory", async () => {
    const profile = applyPreferenceDelta({
      profile: createNeutralPreferenceProfile(1),
      delta: preferenceDeltaForOption("more-relaxed"),
      source: "explicit_edit",
      now: 2,
    });
    await db.preferenceProfiles.put(profile);
    render(<PreferencesPage />);
    const moreSection = await screen.findByRole("region", { name: "More of" });
    expect(within(moreSection).getByText("Relaxed tailoring")).toBeVisible();

    fireEvent.click(within(moreSection).getByRole("button", { name: "Delete Relaxed tailoring" }));
    await waitFor(async () => {
      const updated = await db.preferenceProfiles.get("default");
      expect(updated?.preferenceSignals?.find((signal) => signal.label === "Relaxed tailoring")?.status).toBe("deleted");
      expect(updated?.preferenceNotes.moreOf).not.toContain("Relaxed tailoring");
    });
    expect(within(moreSection).queryByText("Relaxed tailoring")).not.toBeInTheDocument();
  });

  it("keeps unstructured manual language visible for review without activating it as a recommendation signal", async () => {
    await db.preferenceProfiles.put(createNeutralPreferenceProfile(1));
    render(<PreferencesPage />);
    const lessSection = await screen.findByRole("region", { name: "Less of" });
    fireEvent.click(within(lessSection).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New saved preference" }), { target: { value: "No fussy combinations" } });
    fireEvent.click(screen.getByRole("button", { name: "Add for review" }));

    await waitFor(async () => {
      const updated = await db.preferenceProfiles.get("default");
      const signal = updated?.preferenceSignals?.find((candidate) => candidate.label === "No fussy combinations");
      expect(signal).toMatchObject({ attribute: "preference_note", polarity: "less", status: "needs_review" });
      expect(updated?.softPreferences).toEqual([]);
    });
    expect(await screen.findByText("Needs review")).toBeVisible();
  });

  it("serializes rapid canonical edits so one preference cannot overwrite another", async () => {
    await db.preferenceProfiles.put(createNeutralPreferenceProfile(1));
    render(<PreferencesPage />);
    const moreSection = await screen.findByRole("region", { name: "More of" });
    fireEvent.click(within(moreSection).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Relaxed tailoring" }));
    fireEvent.click(screen.getByRole("button", { name: "Clean layers" }));

    await waitFor(async () => {
      const updated = await db.preferenceProfiles.get("default");
      const active = updated?.preferenceSignals?.filter((signal) => signal.status === "active").map((signal) => signal.label);
      expect(active).toEqual(expect.arrayContaining(["Relaxed tailoring", "Clean layers"]));
    });
  });
});
