import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const sessions: Array<{
    listeners: Map<string, Set<(...args: unknown[]) => void>>;
    transportListeners: Map<string, Set<(...args: unknown[]) => void>>;
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    mute: ReturnType<typeof vi.fn>;
    emit(event: string, ...args: unknown[]): void;
    emitTransport(event: string, ...args: unknown[]): void;
  }> = [];
  class FakeRealtimeSession {
    readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    readonly transportListeners = new Map<string, Set<(...args: unknown[]) => void>>();
    connect = vi.fn(async () => undefined);
    close = vi.fn();
    mute = vi.fn();
    transport = {
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const listeners = this.transportListeners.get(event) ?? new Set();
        listeners.add(listener);
        this.transportListeners.set(event, listeners);
      },
    };
    constructor() { sessions.push(this); }
    on(event: string, listener: (...args: unknown[]) => void) {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
    }
    emit(event: string, ...args: unknown[]) { this.listeners.get(event)?.forEach((listener) => listener(...args)); }
    emitTransport(event: string, ...args: unknown[]) { this.transportListeners.get(event)?.forEach((listener) => listener(...args)); }
  }
  return { sessions, FakeRealtimeSession };
});

vi.mock("@openai/agents/realtime", () => ({
  RealtimeAgent: class FakeRealtimeAgent {},
  RealtimeSession: sdk.FakeRealtimeSession,
  tool: (definition: unknown) => definition,
}));

import { OpenAIRealtimeVoiceAdapter, createRealtimeVoiceTools, type VoiceToolHandlers } from "@/lib/realtime/voice-session";
import { PreferenceDeltaSchema, type PreferenceDelta } from "@/domain/schemas";

const handlers: VoiceToolHandlers = {
  requestRecommendation: async () => ({ success: false, summary: "unused" }),
  revise: async () => ({ success: false, summary: "unused" }),
  confirm: async () => ({ success: false, summary: "unused" }),
  setAvailability: async () => ({ success: false, summary: "unused" }),
  savePreference: async () => ({ success: false, summary: "unused" }),
};

beforeEach(() => {
  sdk.sessions.length = 0;
  vi.restoreAllMocks();
});

describe("OpenAIRealtimeVoiceAdapter transport boundary", () => {
  it("exposes only a strict structured PreferenceDelta tool in Fine-tune sessions", async () => {
    const savePreference = vi.fn<(delta: PreferenceDelta) => Promise<{ success: boolean; summary: string }>>().mockResolvedValue({ success: true, summary: "Saved." });
    const preferenceHandlers: VoiceToolHandlers = { ...handlers, savePreference };
    const tools = createRealtimeVoiceTools(preferenceHandlers, "fine-tune");
    expect(tools).toHaveLength(1);
    const preferenceTool = tools[0] as unknown as { name: string; execute(value: unknown): Promise<unknown> };
    const delta = PreferenceDeltaSchema.parse({
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

    await expect(preferenceTool.execute(delta)).resolves.toEqual({ success: true, summary: "Saved." });
    expect(savePreference).toHaveBeenCalledWith(delta);
    expect(() => preferenceTool.execute({ rule: "silver jewelry", polarity: "prefer", evidencePhrase: "Usually silver" })).toThrow();
  });

  it("uses one token and one transport for connect, multiple turns, and cleanup", async () => {
    const attemptId = crypto.randomUUID();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      value: "ek_test-only",
      model: "gpt-realtime-test",
      voice: "marin",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const states: string[] = [];
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers, { attemptId, sessionGeneration: 3, purpose: "today" });
    adapter.onState((state) => states.push(state));

    const first = adapter.connect();
    const second = adapter.connect();
    await Promise.all([first, second]);
    const session = sdk.sessions[0]!;
    session.emitTransport("connection_change", "connected");
    session.emit("audio_start");
    session.emit("audio_stopped");
    await adapter.connect();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-YiYi-Voice-Attempt": attemptId,
      "X-YiYi-Voice-Generation": "3",
    });
    expect(sdk.sessions).toHaveLength(1);
    expect(session.connect).toHaveBeenCalledTimes(1);
    expect(states).toContain("speaking");
    expect(states.at(-1)).toBe("listening");

    await adapter.disconnect();
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("idle");
  });

  it("ignores late events after disconnect", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const states: string[] = [];
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers);
    adapter.onState((state) => states.push(state));
    await adapter.connect();
    const session = sdk.sessions[0]!;
    await adapter.disconnect();
    session.emit("audio_start");
    session.emitTransport("connection_change", "disconnected");

    expect(states.at(-1)).toBe("idle");
    expect(states.filter((state) => state === "error")).toHaveLength(0);
  });
});
