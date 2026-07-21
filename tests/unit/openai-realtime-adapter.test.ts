import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const sessions: Array<{
    listeners: Map<string, Set<(...args: unknown[]) => void>>;
    transportListeners: Map<string, Set<(...args: unknown[]) => void>>;
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    mute: ReturnType<typeof vi.fn>;
    interrupt: ReturnType<typeof vi.fn>;
    sendEvent: ReturnType<typeof vi.fn>;
    requestResponse: ReturnType<typeof vi.fn>;
    updateSessionConfig: ReturnType<typeof vi.fn>;
    updateAgent: ReturnType<typeof vi.fn>;
    agent: unknown;
    options: unknown;
    emit(event: string, ...args: unknown[]): void;
    emitTransport(event: string, ...args: unknown[]): void;
  }> = [];
  const agents: unknown[] = [];
  class FakeRealtimeSession {
    readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    readonly transportListeners = new Map<string, Set<(...args: unknown[]) => void>>();
    connect = vi.fn(async () => undefined);
    close = vi.fn();
    mute = vi.fn();
    interrupt = vi.fn();
    sendEvent = vi.fn();
    requestResponse = vi.fn();
    options: unknown;
    updateSessionConfig = vi.fn();
    agent: unknown;
    updateAgent = vi.fn(async (agent: unknown) => {
      this.agent = agent;
      return agent;
    });
    transport = {
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const listeners = this.transportListeners.get(event) ?? new Set();
        listeners.add(listener);
        this.transportListeners.set(event, listeners);
      },
      updateSessionConfig: this.updateSessionConfig,
      sendEvent: this.sendEvent,
      requestResponse: this.requestResponse,
    };
    constructor(agent: unknown, options: unknown) { this.agent = agent; this.options = options; sessions.push(this); }
    on(event: string, listener: (...args: unknown[]) => void) {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
    }
    emit(event: string, ...args: unknown[]) { this.listeners.get(event)?.forEach((listener) => listener(...args)); }
    emitTransport(event: string, ...args: unknown[]) { this.transportListeners.get(event)?.forEach((listener) => listener(...args)); }
  }
  return { agents, sessions, FakeRealtimeSession };
});

vi.mock("@openai/agents/realtime", () => ({
  RealtimeAgent: class FakeRealtimeAgent {
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
      sdk.agents.push(input);
    }
  },
  RealtimeSession: sdk.FakeRealtimeSession,
  tool: (definition: unknown) => definition,
}));

import { OpenAIRealtimeVoiceAdapter, VoiceConnectionFailure, createRealtimeVoiceTools, type VoiceToolHandlers } from "@/lib/realtime/voice-session";
import { PreferenceDeltaSchema, type PreferenceDelta } from "@/domain/schemas";

const handlers: VoiceToolHandlers = {
  requestRecommendation: async () => ({ success: false, summary: "unused" }),
  handleTurn: async () => ({ success: false, summary: "unused" }),
  savePreference: async () => ({ success: false, summary: "unused" }),
};

beforeEach(() => {
  sdk.agents.length = 0;
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

  it("accepts a minimal first-turn intent and fills safe defaults instead of requiring formatting trivia", async () => {
    const requestRecommendation = vi.fn().mockResolvedValue({ success: true, summary: "Ready." });
    const tools = createRealtimeVoiceTools({ ...handlers, requestRecommendation }, "today");
    const recommendationTool = tools.find((candidate) => (candidate as { name?: string }).name === "request_outfit_recommendation") as unknown as { execute(value: unknown): Promise<unknown>; errorFunction(context: unknown, error: unknown): unknown };

    await recommendationTool.execute({ freeformSummary: "Hiking, then dinner, with my navy hoodie." });
    expect(requestRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      activities: [],
      aestheticTerms: [],
      excludedCategories: [],
      excludedItemIds: [],
      requiredItemIds: [],
      temporaryPreferences: [],
      temporaryItemRules: [],
      comfortPriority: 3,
      photoPriority: 3,
      walkingIntensity: 2,
    }));

    let validationError: unknown;
    try { await recommendationTool.execute({ freeformSummary: "" }); }
    catch (error) { validationError = error; }
    expect(JSON.parse(String(recommendationTool.errorFunction(null, validationError)))).toMatchObject({
      success: false,
      failureStage: "tool",
      errorCode: "TOOL_ARGUMENTS_INVALID",
      zodIssuePaths: ["freeformSummary"],
    });
  });

  it("accepts a minimal follow-up action without confidence, ambiguity, UUIDs, or an internal delta", async () => {
    const handleTurn = vi.fn().mockResolvedValue({ success: true, summary: "Changed.", changedSlots: ["shoes"], outfitVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const tools = createRealtimeVoiceTools({ ...handlers, handleTurn }, "today");
    const actionTool = tools.find((candidate) => (candidate as { name?: string }).name === "handle_outfit_turn") as unknown as { execute(value: unknown): Promise<unknown> };
    await actionTool.execute({ action: "revise", userRequest: "Make the shoes more relaxed", targetSlot: "shoes", targetDescription: "shoes", availability: null });
    expect(handleTurn).toHaveBeenCalledWith({ action: "revise", userRequest: "Make the shoes more relaxed", targetSlot: "shoes", targetDescription: "shoes", availability: null });
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

  it("uses conservative automatic interruption and switches agents only after successful initial mutation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers, { purpose: "today", requireInitialRecommendation: true });
    await adapter.connect();
    const session = sdk.sessions[0]!;

    expect(session.options).toMatchObject({
      config: {
        toolChoice: "required",
        audio: { input: { turnDetection: { type: "semantic_vad", eagerness: "auto", interruptResponse: false } } },
      },
    });
    expect((session.agent as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual([
      "request_outfit_recommendation",
    ]);
    session.emit("agent_tool_start", {}, {}, { name: "request_outfit_recommendation" }, { toolCall: { callId: "call-1" } });
    expect(session.updateAgent).not.toHaveBeenCalled();
    expect(session.updateSessionConfig).toHaveBeenLastCalledWith({ toolChoice: "auto" });
    session.emit("agent_tool_end", {}, {}, { name: "request_outfit_recommendation" }, JSON.stringify({ success: true, summary: "Ready." }), { toolCall: { callId: "call-1" } });
    await vi.waitFor(() => expect(session.updateAgent).toHaveBeenCalledTimes(1));
    expect(((session.updateAgent.mock.calls[0]?.[0]) as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual([
      "request_outfit_recommendation",
      "handle_outfit_turn",
      "save_explicit_preference",
    ]);
    expect(session.updateSessionConfig).not.toHaveBeenCalledWith({ toolChoice: "required" });
    session.emit("audio_stopped");
    expect(session.updateSessionConfig).toHaveBeenLastCalledWith({ toolChoice: "required" });
  });

  it("does not switch runtime agents after a failed initial mutation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers, { purpose: "today", requireInitialRecommendation: true });
    await adapter.connect();
    const session = sdk.sessions[0]!;
    const tool = { name: "request_outfit_recommendation" };
    session.emit("agent_tool_start", {}, {}, tool, { toolCall: { callId: "call-1" } });
    session.emit("agent_tool_end", {}, {}, tool, JSON.stringify({ success: false, summary: "No legal outfit.", failureStage: "recommendation", errorCode: "NO_LEGAL_OUTFIT" }), { toolCall: { callId: "call-1" } });
    expect(session.updateAgent).not.toHaveBeenCalled();
  });

  it("manual commit and speaking interruption use the existing transport without reconnecting", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers, { purpose: "today" });
    await adapter.connect();
    const session = sdk.sessions[0]!;

    adapter.commitTurn?.();
    expect(session.mute).toHaveBeenLastCalledWith(true);
    expect(session.sendEvent).toHaveBeenCalledWith({ type: "input_audio_buffer.commit" });
    expect(session.requestResponse).toHaveBeenCalledOnce();
    session.emit("audio_start");
    adapter.interruptAndListen?.();
    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.mute).toHaveBeenLastCalledWith(false);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("deduplicates repeated follow-up tool calls within one committed turn", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const handleTurn = vi.fn().mockResolvedValue({ success: true, summary: "Changed.", changedSlots: ["shoes"], outfitVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const adapter = new OpenAIRealtimeVoiceAdapter({ ...handlers, handleTurn }, { purpose: "today" });
    await adapter.connect();
    const session = sdk.sessions[0]!;
    const actionTool = (session.agent as { tools: Array<{ name: string; execute(input: unknown): Promise<unknown> }> }).tools.find((candidate) => candidate.name === "handle_outfit_turn")!;
    const first = actionTool.execute({ action: "revise", userRequest: "Change the shoes", targetSlot: "shoes", targetDescription: "shoes", availability: null });
    const repeated = actionTool.execute({ action: "revise", userRequest: "Change the shoes again", targetSlot: "shoes", targetDescription: "shoes", availability: null });
    await expect(Promise.all([first, repeated])).resolves.toEqual([
      expect.objectContaining({ outfitVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      expect.objectContaining({ outfitVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ]);
    expect(handleTurn).toHaveBeenCalledOnce();
  });

  it("keeps an active session connected after confirm and accepts a later revision", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const handleTurn = vi.fn()
      .mockResolvedValueOnce({ success: true, summary: "Outfit decided.", changedSlots: [], outfitVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
      .mockResolvedValueOnce({ success: true, summary: "I changed the shoes.", changedSlots: ["shoes"], removedItemIds: ["old-shoes"], addedItemIds: ["new-shoes"], outfitVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    const adapter = new OpenAIRealtimeVoiceAdapter({ ...handlers, handleTurn }, { purpose: "today" });
    await adapter.connect();
    const session = sdk.sessions[0]!;
    const actionTool = (session.agent as { tools: Array<{ name: string; execute(input: unknown): Promise<unknown> }> }).tools.find((candidate) => candidate.name === "handle_outfit_turn")!;

    session.emit("agent_tool_start", {}, {}, actionTool, { toolCall: { callId: "confirm-1" } });
    const confirmed = await actionTool.execute({ action: "confirm", userRequest: "Wear this today", targetSlot: null, targetDescription: null, availability: null });
    session.emit("agent_tool_end", {}, {}, actionTool, JSON.stringify(confirmed), { toolCall: { callId: "confirm-1" } });
    session.emit("audio_stopped");

    expect(session.close).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledOnce();

    const revised = await actionTool.execute({ action: "revise", userRequest: "Change the shoes", targetSlot: "shoes", targetDescription: "shoes", availability: null });
    expect(revised).toMatchObject({ success: true, changedSlots: ["shoes"], outfitVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(handleTurn).toHaveBeenCalledTimes(2);
    expect(session.close).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("clears the no-tool watchdog after a successful initial recommendation and keeps the session reusable", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const requestRecommendation = vi.fn().mockResolvedValue({ success: true, summary: "Ready." });
    const adapter = new OpenAIRealtimeVoiceAdapter({ ...handlers, requestRecommendation }, { purpose: "today", requireInitialRecommendation: true });
    const states: string[] = [];
    const failures: string[] = [];
    adapter.onState((state) => states.push(state));
    adapter.onFailure((failure) => failures.push(failure.code));
    await adapter.connect();
    const session = sdk.sessions[0]!;
    const recommendationTool = (session.agent as { tools: Array<{ name: string; execute(input: unknown): Promise<unknown> }> }).tools[0]!;

    session.emit("transport_event", { type: "input_audio_buffer.speech_stopped" });
    session.emit("agent_tool_start", {}, {}, recommendationTool, { toolCall: { callId: "call-1" } });
    const result = await recommendationTool.execute({ freeformSummary: "Hiking and dinner." });
    session.emit("agent_tool_end", {}, {}, recommendationTool, JSON.stringify(result), { toolCall: { callId: "call-1" } });
    session.emit("audio_stopped");
    await vi.advanceTimersByTimeAsync(15_000);

    expect(requestRecommendation).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]);
    expect(states.at(-1)).toBe("listening");
    expect(session.updateAgent).toHaveBeenCalledTimes(1);

    session.emit("transport_event", { type: "input_audio_buffer.speech_stopped" });
    const runtimeTool = (session.agent as { tools: Array<{ name: string }> }).tools.find((candidate) => candidate.name === "handle_outfit_turn")!;
    session.emit("agent_tool_start", {}, {}, runtimeTool, { toolCall: { callId: "call-2" } });
    session.emit("agent_tool_end", {}, {}, runtimeTool, JSON.stringify({ success: true, summary: "No change.", changedSlots: [], outfitVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), { toolCall: { callId: "call-2" } });
    session.emit("audio_stopped");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(failures).toEqual([]);
    vi.useRealTimers();
  });

  it("emits user and assistant transcripts separately when one full history update contains both", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers);
    const transcripts: Array<{ role: string; text: string; final: boolean }> = [];
    adapter.onTranscript((transcript) => transcripts.push(transcript));
    await adapter.connect();

    sdk.sessions[0]!.emit("history_updated", [
      { itemId: "user-1", type: "message", role: "user", status: "completed", content: [{ type: "input_audio", transcript: "Hiking and dinner." }] },
      { itemId: "assistant-1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_audio", transcript: "I found one." }] },
    ]);

    expect(transcripts).toEqual([
      { role: "user", text: "Hiking and dinner.", final: true },
      { role: "assistant", text: "I found one.", final: true },
    ]);
  });

  it("does not return to Listening when assistant audio ends before the required recommendation tool succeeds", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers, { purpose: "today", requireInitialRecommendation: true });
    const states: string[] = [];
    const failures: string[] = [];
    adapter.onState((state) => states.push(state));
    adapter.onFailure((failure) => failures.push(failure.code));
    await adapter.connect();
    const session = sdk.sessions[0]!;

    session.emit("transport_event", { type: "input_audio_buffer.speech_stopped" });
    session.emit("audio_start");
    session.emit("audio_stopped");
    expect(states.at(-1)).not.toBe("listening");

    await vi.advanceTimersByTimeAsync(15_000);
    expect(failures).toEqual(["INITIAL_RECOMMENDATION_TIMEOUT"]);
    expect(states.at(-1)).toBe("recoverable_error");
    vi.useRealTimers();
  });

  it("does not clear the unresolved first turn when speech interrupts a running recommendation tool", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers, { purpose: "today", requireInitialRecommendation: true });
    const states: string[] = [];
    adapter.onState((state) => states.push(state));
    await adapter.connect();
    const session = sdk.sessions[0]!;

    session.emit("transport_event", { type: "input_audio_buffer.speech_stopped" });
    session.emit("agent_tool_start", {}, {}, { name: "request_outfit_recommendation" }, { toolCall: { callId: "call-1" } });
    session.emit("transport_event", { type: "input_audio_buffer.speech_started" });
    session.emit("audio_stopped");

    expect(states.at(-1)).toBe("tool_running");
  });

  it("preserves tool argument failure classification and safe issue paths in diagnostics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ value: "ek_test-only", model: "gpt-realtime-test", voice: "marin" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const diagnostics: Array<Record<string, unknown>> = [];
    const failures: VoiceConnectionFailure[] = [];
    const adapter = new OpenAIRealtimeVoiceAdapter(handlers, {
      attemptId: crypto.randomUUID(),
      sessionGeneration: 4,
      purpose: "today",
      requireInitialRecommendation: true,
      diagnostic: (entry) => diagnostics.push(entry),
    });
    adapter.onFailure((failure) => failures.push(failure));
    await adapter.connect();
    const session = sdk.sessions[0]!;
    const tool = { name: "request_outfit_recommendation" };
    session.emit("agent_tool_start", {}, {}, tool, { toolCall: { callId: "call-1" } });
    session.emit("agent_tool_end", {}, {}, tool, JSON.stringify({ success: false, summary: "Try again.", failureStage: "tool", errorCode: "TOOL_ARGUMENTS_INVALID", zodIssuePaths: ["requiredItemIds.0"] }), { toolCall: { callId: "call-1" } });

    expect(failures.at(-1)).toMatchObject({ stage: "tool", code: "TOOL_ARGUMENTS_INVALID", zodIssuePaths: ["requiredItemIds.0"] });
    expect(diagnostics.at(-1)).toMatchObject({ stage: "tool", result: "error", errorCode: "TOOL_ARGUMENTS_INVALID", zodIssuePaths: ["requiredItemIds.0"] });
    expect(JSON.stringify(diagnostics)).not.toContain("Hiking");
  });
});
