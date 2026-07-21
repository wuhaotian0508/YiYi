import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FineTuneVoice, type FineTuneAdapterFactory } from "@/components/preferences/fine-tune-voice";
import { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";
import { buildCalibrationPreferenceProfile, createCalibrationResponse } from "@/domain/preferences/calibration-engine";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { applyPreferenceDelta } from "@/domain/preferences/profile-mutations";
import { PreferenceDeltaSchema, type PreferenceDelta, type PreferenceProfile } from "@/domain/schemas";
import { VoiceSessionCoordinator } from "@/lib/realtime/voice-session-coordinator";
import type { TranscriptState, VoiceConnectionFailure, VoiceSessionAdapter, VoiceState } from "@/lib/realtime/voice-session";

class FakePreferenceAdapter implements VoiceSessionAdapter {
  readonly stateListeners = new Set<(state: VoiceState) => void>();
  readonly transcriptListeners = new Set<(transcript: TranscriptState) => void>();
  readonly failureListeners = new Set<(failure: VoiceConnectionFailure) => void>();
  connect = vi.fn(async () => { this.stateListeners.forEach((listener) => listener("listening")); });
  disconnect = vi.fn(async () => { this.stateListeners.forEach((listener) => listener("idle")); });
  mute = vi.fn();
  commitTurn = vi.fn();
  interruptAndListen = vi.fn();
  onState(listener: (state: VoiceState) => void) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcriptListeners.add(listener); return () => this.transcriptListeners.delete(listener); }
  onFailure(listener: (failure: VoiceConnectionFailure) => void) { this.failureListeners.add(listener); return () => this.failureListeners.delete(listener); }
  emitTranscript(text: string) { this.transcriptListeners.forEach((listener) => listener({ role: "user", text, final: true })); }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function silverDelta(): PreferenceDelta {
  return PreferenceDeltaSchema.parse({
    action: "add",
    signalId: null,
    attribute: "metal",
    value: "silver",
    label: "Silver jewelry",
    polarity: "more",
    strength: "soft",
    scope: "category",
    categories: ["jewelry"],
    slots: ["jewelry"],
    combinationValues: [],
    confidence: 0.98,
    needsReview: false,
    evidenceSummary: "Usually prefer silver jewelry",
  });
}

describe("FineTuneVoice", () => {
  it("maps the central control to start, commit, and interrupt using the shared turn controller", async () => {
    const adapter = new FakePreferenceAdapter();
    const coordinator = new VoiceSessionCoordinator({ diagnostic: () => undefined });
    render(<FineTuneVoice profile={createNeutralPreferenceProfile(1)} onSaveDelta={vi.fn()} onProfileChange={vi.fn()} coordinator={coordinator} voiceMode="live" createAdapter={() => adapter} />);

    fireEvent.click(screen.getByRole("button", { name: "Tell YiYi another preference" }));
    await waitFor(() => expect(adapter.connect).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Done speaking" }));
    expect(adapter.commitTurn).toHaveBeenCalledOnce();

    act(() => adapter.stateListeners.forEach((listener) => listener("speaking")));
    fireEvent.click(screen.getByRole("button", { name: "Interrupt YiYi" }));
    expect(adapter.interruptAndListen).toHaveBeenCalledOnce();
  });
  it("does not treat a live final transcript as success and reports done only after the tool persistence resolves", async () => {
    const adapter = new FakePreferenceAdapter();
    let toolHandler: ((delta: PreferenceDelta) => Promise<{ success: boolean; summary: string }>) | undefined;
    const createAdapter: FineTuneAdapterFactory = ({ handlers }) => {
      toolHandler = handlers.savePreference;
      return adapter;
    };
    let resolveSave: ((profile: PreferenceProfile) => void) | undefined;
    const saveDelta = vi.fn(() => new Promise<PreferenceProfile>((resolve) => { resolveSave = resolve; }));
    const coordinator = new VoiceSessionCoordinator({ diagnostic: () => undefined });
    const profile = createNeutralPreferenceProfile(1);

    render(<FineTuneVoice profile={profile} onSaveDelta={saveDelta} onProfileChange={() => undefined} coordinator={coordinator} voiceMode="live" createAdapter={createAdapter} />);
    fireEvent.click(screen.getByRole("button", { name: "Tell YiYi another preference" }));
    await waitFor(() => expect(adapter.connect).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    act(() => adapter.emitTranscript("I usually prefer silver jewelry"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(saveDelta).not.toHaveBeenCalled();
    expect(screen.queryByText("Added to your profile")).not.toBeInTheDocument();
    vi.useRealTimers();

    let toolResult: Promise<{ success: boolean; summary: string }> | undefined;
    act(() => { toolResult = toolHandler?.(silverDelta()); });
    await waitFor(() => expect(saveDelta).toHaveBeenCalledWith(silverDelta()));
    expect(screen.getByText("Saving preference…")).toBeVisible();
    expect(screen.queryByText("Added to your profile")).not.toBeInTheDocument();
    act(() => resolveSave?.(profile));
    await expect(toolResult).resolves.toEqual({ success: true, summary: "Saved as an editable long-term preference." });
    expect(await screen.findByText("Added to your profile")).toBeVisible();
  });

  it("uses the fixed mock interpreter but sends every result through the same persistence callback", async () => {
    const adapter = new FakePreferenceAdapter();
    const createAdapter: FineTuneAdapterFactory = () => adapter;
    const profile = createNeutralPreferenceProfile(1);
    const saveDelta = vi.fn<(delta: PreferenceDelta) => Promise<PreferenceProfile>>().mockResolvedValue(profile);
    const coordinator = new VoiceSessionCoordinator({ diagnostic: () => undefined });

    render(<FineTuneVoice profile={profile} onSaveDelta={saveDelta} onProfileChange={() => undefined} coordinator={coordinator} voiceMode="mock" createAdapter={createAdapter} />);
    fireEvent.click(screen.getByRole("button", { name: "Tell YiYi another preference" }));
    await waitFor(() => expect(adapter.connect).toHaveBeenCalledTimes(1));
    act(() => adapter.emitTranscript("More soft textures and less formal structure"));

    await waitFor(() => expect(saveDelta).toHaveBeenCalledTimes(2));
    expect(saveDelta.mock.calls.map(([delta]) => [delta.attribute, delta.polarity])).toEqual([
      ["style", "more"],
      ["formality", "less"],
    ]);
    expect(await screen.findByText("Added to your profile")).toBeVisible();
    expect(screen.queryByText(/More soft textures and less formal structure/)).not.toBeInTheDocument();
    await waitFor(() => expect(adapter.disconnect).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Tell YiYi another preference" }));
    await waitFor(() => expect(adapter.connect).toHaveBeenCalledTimes(2));
  });

  it("shows a persistence-specific failure and never claims the preference was added", async () => {
    const adapter = new FakePreferenceAdapter();
    let toolHandler: ((delta: PreferenceDelta) => Promise<{ success: boolean; summary: string }>) | undefined;
    const createAdapter: FineTuneAdapterFactory = ({ handlers }) => { toolHandler = handlers.savePreference; return adapter; };
    const coordinator = new VoiceSessionCoordinator({ diagnostic: () => undefined });

    render(<FineTuneVoice profile={createNeutralPreferenceProfile(1)} onSaveDelta={async () => { throw new Error("write failed"); }} onProfileChange={() => undefined} coordinator={coordinator} voiceMode="live" createAdapter={createAdapter} />);
    fireEvent.click(screen.getByRole("button", { name: "Tell YiYi another preference" }));
    await waitFor(() => expect(adapter.connect).toHaveBeenCalledTimes(1));
    await expect(toolHandler?.(silverDelta())).resolves.toEqual({ success: false, summary: "I understood that, but it was not saved." });

    expect(await screen.findByText("YiYi understood you, but couldn’t save it. Try again.")).toBeVisible();
    expect(screen.queryByText("Added to your profile")).not.toBeInTheDocument();
  });

  it("reports the persisted review status even when its label matches an active calibration signal", async () => {
    const adapter = new FakePreferenceAdapter();
    let toolHandler: ((delta: PreferenceDelta) => Promise<{ success: boolean; summary: string }>) | undefined;
    const createAdapter: FineTuneAdapterFactory = ({ handlers }) => { toolHandler = handlers.savePreference; return adapter; };
    const coordinator = new VoiceSessionCoordinator({ diagnostic: () => undefined });
    const question = calibrationCatalogV2.questions[0];
    const profile = buildCalibrationPreferenceProfile({
      direction: "neutral",
      responses: [createCalibrationResponse(question.id, "a", 1)],
      now: 2,
    });
    const reviewDelta = PreferenceDeltaSchema.parse({
      action: "add",
      signalId: null,
      attribute: "preference_note",
      value: "relaxed everyday for work",
      label: question.optionA.label,
      polarity: "more",
      strength: "soft",
      scope: "global_style",
      categories: [],
      slots: [],
      combinationValues: [],
      confidence: 0.5,
      needsReview: true,
      evidenceSummary: "Ambiguous preference for review",
    });
    const updated = applyPreferenceDelta({ profile, delta: reviewDelta, now: 3, source: "explicit_voice" });

    render(<FineTuneVoice profile={profile} onSaveDelta={async () => updated} onProfileChange={() => undefined} coordinator={coordinator} voiceMode="live" createAdapter={createAdapter} />);
    fireEvent.click(screen.getByRole("button", { name: "Tell YiYi another preference" }));
    await waitFor(() => expect(adapter.connect).toHaveBeenCalledTimes(1));
    await expect(toolHandler?.(reviewDelta)).resolves.toEqual({ success: true, summary: "Saved as an editable note for review." });

    expect(await screen.findByText("Saved for review")).toBeVisible();
    expect(screen.queryByText("Added to your profile")).not.toBeInTheDocument();
  });
});
