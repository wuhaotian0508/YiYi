import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import TodayPage from "@/app/today/page";
import { VoiceConnectionFailure, type TranscriptState, type VoiceSessionAdapter, type VoiceState } from "@/lib/realtime/voice-session";
import { voiceSessionCoordinator } from "@/lib/realtime/voice-session-coordinator";
import { db } from "@/lib/storage/db";

class TranscriptVoiceAdapter implements VoiceSessionAdapter {
  private readonly states = new Set<(state: VoiceState) => void>();
  private readonly transcripts = new Set<(transcript: TranscriptState) => void>();
  private readonly failures = new Set<(failure: VoiceConnectionFailure) => void>();
  async connect() { this.emitState("listening"); }
  async disconnect() { this.emitState("idle"); }
  mute() {}
  onState(listener: (state: VoiceState) => void) { this.states.add(listener); return () => this.states.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcripts.add(listener); return () => this.transcripts.delete(listener); }
  onFailure(listener: (failure: VoiceConnectionFailure) => void) { this.failures.add(listener); return () => this.failures.delete(listener); }
  emitState(state: VoiceState) { this.states.forEach((listener) => listener(state)); }
  emitTranscript(transcript: TranscriptState) { this.transcripts.forEach((listener) => listener(transcript)); }
}

describe("Today live voice recovery", () => {
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "live");
    vi.stubEnv("NEXT_PUBLIC_SEED_DEMO_WARDROBE", "true");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(() => null), length: 0 },
    });
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    cleanup();
    await voiceSessionCoordinator.stop("today", "cleanup");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await db.delete();
  });

  it("releases a failed connection so the central Voice Dock can retry", async () => {
    let tokenRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/weather")) return new Response(null, { status: 503 });
      if (url.includes("/api/realtime/token")) {
        tokenRequests += 1;
        return new Response(JSON.stringify({ error: { message: "Unavailable" } }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<StrictMode><TodayPage /></StrictMode>);
    const dock = await screen.findByRole("button", { name: "Start live voice session" });
    await waitFor(() => expect(dock).toBeEnabled());
    fireEvent.click(dock);
    fireEvent.click(dock);
    await screen.findByText("YiYi couldn’t finish that.");
    expect(tokenRequests).toBe(1);
    expect(screen.queryByText("Listening…")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry live voice" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry live voice" }));
    await waitFor(() => expect(tokenRequests).toBe(2));
  });

  it("keeps assistant captions out of the YOUR DAY transcript", async () => {
    const adapter = new TranscriptVoiceAdapter();
    await voiceSessionCoordinator.start("today", () => adapter);
    adapter.emitTranscript({ role: "user", text: "Hiking, then dinner.", final: true });
    adapter.emitTranscript({ role: "assistant", text: "I found one for you.", final: true });

    render(<TodayPage />);

    expect(await screen.findByRole("heading", { name: "“Hiking, then dinner.”" })).toBeVisible();
    expect(screen.queryByText(/I found one for you/)).not.toBeInTheDocument();
  });
});
