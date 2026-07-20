import { z } from "zod";
import { RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import { ApiErrorSchema, DailyIntentSchema, IntentDeltaSchema, PreferenceDeltaSchema, type IntentDelta, type PreferenceDelta } from "@/domain/schemas";
import { realtimeAgentInstructions } from "@/prompts/realtime-agent";

export type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "interrupted" | "error";
export type TranscriptState = { role: "user" | "assistant"; text: string; final: boolean };
export type VoiceFailureStage = "permission" | "token" | "session" | "webrtc" | "ready" | "tool" | "recommendation" | "persistence" | "audio" | "cleanup" | "lifecycle";

export class VoiceConnectionFailure extends Error {
  readonly stage: VoiceFailureStage;
  readonly code: string;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly errorType?: string;

  constructor(input: { stage: VoiceFailureStage; code: string; httpStatus?: number; retryAfterMs?: number; errorType?: string; message?: string }) {
    super(input.message ?? input.code);
    this.name = "VoiceConnectionFailure";
    this.stage = input.stage;
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.retryAfterMs = input.retryAfterMs;
    this.errorType = input.errorType;
  }
}

export interface VoiceSessionAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  mute(muted: boolean): void;
  onState(listener: (state: VoiceState) => void): () => void;
  onTranscript(listener: (transcript: TranscriptState) => void): () => void;
  onFailure(listener: (failure: VoiceConnectionFailure) => void): () => void;
  submitDemoTurn?(): void;
}

export type VoiceToolHandlers = {
  requestRecommendation(intent: z.infer<typeof DailyIntentSchema>): Promise<{ success: boolean; summary: string }>;
  revise(input: IntentDelta): Promise<{ success: boolean; summary: string }>;
  confirm(note: string | null): Promise<{ success: boolean; summary: string }>;
  setAvailability(input: { itemId: string | null; availability: "available" | "laundry" | "unavailable"; reason: string | null }): Promise<{ success: boolean; summary: string }>;
  savePreference(input: PreferenceDelta): Promise<{ success: boolean; summary: string }>;
};

export type VoiceAdapterOptions = {
  attemptId?: string;
  sessionGeneration?: number;
  purpose?: "today" | "fine-tune";
};

export function resolveAvailabilityItemId(explicitItemId: string | null, focusedItemId: string | null) {
  return explicitItemId ?? focusedItemId;
}

export const yiyiTurnDetection = {
  type: "semantic_vad",
  eagerness: "low",
  createResponse: true,
  interruptResponse: true,
} as const;

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

const ConfirmToolSchema = z.object({ note: z.string().max(160).nullable() }).strict();
const AvailabilityToolSchema = z.object({ itemId: z.string().uuid().nullable(), availability: z.enum(["available", "laundry", "unavailable"]), reason: z.string().max(120).nullable() }).strict();
function strictRealtimeTool<TSchema extends z.ZodType>(input: {
  name: string;
  description: string;
  schema: TSchema;
  timeoutMs: number;
  execute(value: z.infer<TSchema>): Promise<{ success: boolean; summary: string }>;
}) {
  const generated = z.toJSONSchema(input.schema, { io: "input" }) as { properties?: Record<string, unknown>; required?: string[] };
  const parameters = {
    ...generated,
    type: "object" as const,
    properties: generated.properties ?? {},
    required: generated.required ?? [],
    additionalProperties: false as const,
  };
  return tool({
    name: input.name,
    description: input.description,
    parameters,
    strict: true,
    timeoutMs: input.timeoutMs,
    execute: (value: unknown) => input.execute(input.schema.parse(value)),
  });
}

export function createRealtimeVoiceTools(handlers: VoiceToolHandlers, purpose: VoiceAdapterOptions["purpose"] = "today") {
  const preferenceTool = strictRealtimeTool({
    name: "save_explicit_preference",
    description: "Save one explicit long-term preference as a validated semantic delta. Use action=add and signalId=null for new preferences. Map style, subtype, fit, color, material, category, metal, comfort, formality, and conjunctive combination literally; use category/slot scope when relevant. A combination such as black-and-white stays one combination signal, never two color bans. Only explicit negative language may use strength=hard. If the meaning cannot be represented safely, use preference_note with needsReview=true; it will remain visible but inactive. evidenceSummary is a concise semantic paraphrase, not a full transcript.",
    schema: PreferenceDeltaSchema,
    timeoutMs: 8_000,
    execute: (input) => handlers.savePreference(input),
  });
  if (purpose === "fine-tune") return [preferenceTool];
  return [
    strictRealtimeTool({ name: "request_outfit_recommendation", description: "Select one decisive outfit from an internal pool of legal candidates.", schema: DailyIntentSchema, timeoutMs: 25_000, execute: (input) => handlers.requestRecommendation(input) }),
    strictRealtimeTool({ name: "revise_current_outfit", description: "Return a complete structured delta for targeted, global, random, or undo operations. Encode warmth, comfort, formality, colorfulness, preservation, required items, and exclusions explicitly; rawUtterance alone never changes the outfit.", schema: IntentDeltaSchema, timeoutMs: 20_000, execute: (input) => handlers.revise(input) }),
    strictRealtimeTool({ name: "confirm_current_outfit", description: "Confirm and persist the current outfit before telling the user it is decided.", schema: ConfirmToolSchema, timeoutMs: 8_000, execute: ({ note }) => handlers.confirm(note) }),
    strictRealtimeTool({ name: "set_item_availability", description: "Mark an explicit item ID or the currently focused wardrobe item available, in laundry, or unavailable. Pass null when no item ID is known.", schema: AvailabilityToolSchema, timeoutMs: 8_000, execute: (input) => handlers.setAvailability(input) }),
    preferenceTool,
  ];
}

export class OpenAIRealtimeVoiceAdapter implements VoiceSessionAdapter {
  private session: RealtimeSession | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectGeneration = 0;
  private connectAbortController: AbortController | null = null;
  private readonly stateListeners = new Set<(state: VoiceState) => void>();
  private readonly transcriptListeners = new Set<(transcript: TranscriptState) => void>();
  private readonly failureListeners = new Set<(failure: VoiceConnectionFailure) => void>();
  private currentState: VoiceState = "idle";
  private connected = false;

  constructor(private readonly handlers: VoiceToolHandlers, private readonly options: VoiceAdapterOptions = {}) {}

  connect() {
    if (this.connectPromise) return this.connectPromise;
    if (this.session) return Promise.resolve();
    const promise = this.connectOnce();
    this.connectPromise = promise;
    void promise.then(
      () => { if (this.connectPromise === promise) this.connectPromise = null; },
      () => { if (this.connectPromise === promise) this.connectPromise = null; },
    );
    return promise;
  }

  private async connectOnce() {
    const generation = ++this.connectGeneration;
    this.connectAbortController?.abort();
    this.session?.close();
    this.session = null;
    const connectAbortController = new AbortController();
    this.connectAbortController = connectAbortController;
    this.emitState("connecting");
    let session: RealtimeSession | null = null;
    try {
      let response: Response;
      try {
        response = await fetch("/api/realtime/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.options.attemptId ? { "X-YiYi-Voice-Attempt": this.options.attemptId } : {}),
            ...(this.options.sessionGeneration !== undefined ? { "X-YiYi-Voice-Generation": String(this.options.sessionGeneration) } : {}),
          },
          cache: "no-store",
          signal: connectAbortController.signal,
        });
      } catch (error) {
        if (connectAbortController.signal.aborted) throw error;
        throw new VoiceConnectionFailure({ stage: "token", code: "TOKEN_REQUEST_FAILED" });
      }
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw new VoiceConnectionFailure({ stage: "token", code: "TOKEN_RESPONSE_INVALID", httpStatus: response.status }); }
      if (!response.ok) {
        const parsedError = ApiErrorSchema.safeParse(payload);
        throw new VoiceConnectionFailure({
          stage: "token",
          code: parsedError.success ? parsedError.data.error.code : "TOKEN_REQUEST_REJECTED",
          httpStatus: response.status,
          retryAfterMs: response.status === 429 ? retryAfterMilliseconds(response) : undefined,
        });
      }
      if (generation !== this.connectGeneration || connectAbortController.signal.aborted) return;
      const parsedToken = z.object({ value: z.string().min(1), model: z.string().min(1), voice: z.string().min(1) }).safeParse(payload);
      if (!parsedToken.success) throw new VoiceConnectionFailure({ stage: "token", code: "TOKEN_RESPONSE_INVALID", httpStatus: response.status });
      const token = parsedToken.data;
      let agentTools;
      try { agentTools = createRealtimeVoiceTools(this.handlers, this.options.purpose); }
      catch (error) { throw new VoiceConnectionFailure({ stage: "session", code: "TOOL_DEFINITION_FAILED", errorType: error instanceof Error ? error.name : "UnknownError" }); }
      const fineTuneInstructions = "Listen for explicit, lasting clothing or style preferences. For each distinct preference, call save_explicit_preference with a complete structured delta. Example: 'I usually prefer silver jewelry' is attribute metal, value silver, polarity more, soft strength, jewelry category and slot. 'I usually avoid black and white together' is one combination signal with both values, never two color bans. Do not infer the opposite preference, turn uncertainty into a hard rule, or save today's temporary needs. Only say it was added after the tool returns success. Do not recommend an outfit.";
      let agent: RealtimeAgent;
      try { agent = new RealtimeAgent({ name: "YiYi", voice: token.voice, instructions: this.options.purpose === "fine-tune" ? fineTuneInstructions : realtimeAgentInstructions, tools: agentTools }); }
      catch (error) { throw new VoiceConnectionFailure({ stage: "session", code: "AGENT_CONSTRUCTION_FAILED", errorType: error instanceof Error ? error.name : "UnknownError" }); }
      try {
        session = new RealtimeSession(agent, {
          model: token.model,
          transport: "webrtc",
          tracingDisabled: true,
          historyStoreAudio: false,
          config: { audio: { input: { turnDetection: yiyiTurnDetection } } },
        });
      } catch (error) { throw new VoiceConnectionFailure({ stage: "session", code: "SESSION_CONSTRUCTION_FAILED", errorType: error instanceof Error ? error.name : "UnknownError" }); }
      this.session = session;
      const isActive = () => this.session === session && generation === this.connectGeneration;
      session.on("audio_start", () => { if (isActive()) this.emitState("speaking"); });
      session.on("audio_stopped", () => { if (isActive()) this.emitState("listening"); });
      session.on("audio_interrupted", () => { if (isActive()) this.emitState("interrupted"); });
      session.on("agent_start", () => { if (isActive()) this.emitState("thinking"); });
      session.on("agent_tool_start", () => { if (isActive()) this.emitState("thinking"); });
      session.on("error", () => {
        if (!isActive()) return;
        this.emitFailure(new VoiceConnectionFailure({
          stage: !this.connected ? "ready" : this.currentState === "speaking" ? "audio" : "tool",
          code: !this.connected ? "SESSION_READY_FAILED" : this.currentState === "speaking" ? "AUDIO_OUTPUT_FAILED" : "REALTIME_SESSION_FAILED",
        }));
        this.emitState("error");
      });
      session.on("transport_event", (event) => {
        if (!isActive()) return;
        if (event.type === "input_audio_buffer.speech_started") this.emitState("listening");
        if (event.type === "input_audio_buffer.speech_stopped") this.emitState("thinking");
      });
      session.transport.on("connection_change", (status) => {
        if (!isActive()) return;
        if (status === "connecting") this.emitState("connecting");
        if (status === "disconnected") {
          if (!this.connected) return;
          this.emitFailure(new VoiceConnectionFailure({ stage: "webrtc", code: "WEBRTC_DISCONNECTED" }));
          this.emitState("error");
        }
      });
      session.on("history_updated", (history) => {
        if (!isActive()) return;
        const latest = [...history].reverse().find((item) => item.type === "message" && (item.role === "user" || item.role === "assistant"));
        if (!latest || latest.type !== "message" || (latest.role !== "user" && latest.role !== "assistant")) return;
        const text = latest.content.map((content) => "text" in content ? content.text : content.transcript ?? "").join(" ").trim();
        if (text) this.emitTranscript({ role: latest.role, text, final: latest.status === "completed" });
      });
      try { await session.connect({ apiKey: token.value }); }
      catch (error) {
        if (error instanceof DOMException && ["NotAllowedError", "NotFoundError", "SecurityError"].includes(error.name)) {
          throw new VoiceConnectionFailure({ stage: "permission", code: "MICROPHONE_UNAVAILABLE" });
        }
        const awaitingReady = error instanceof Error && /session config|acknowledged/i.test(error.message);
        throw new VoiceConnectionFailure({ stage: awaitingReady ? "ready" : "webrtc", code: awaitingReady ? "SESSION_READY_FAILED" : "WEBRTC_CONNECT_FAILED" });
      }
      if (!isActive()) { session.close(); return; }
      this.connected = true;
      if (this.connectAbortController === connectAbortController) this.connectAbortController = null;
      this.emitState("listening");
    } catch (error) {
      if (this.session === session) this.session = null;
      this.connected = false;
      session?.close();
      if (this.connectAbortController === connectAbortController) this.connectAbortController = null;
      if (connectAbortController.signal.aborted || generation !== this.connectGeneration) return;
      this.emitState("error");
      throw error;
    }
  }

  async disconnect() { this.connectGeneration += 1; this.connectPromise = null; this.connectAbortController?.abort(); this.connectAbortController = null; const session = this.session; this.session = null; this.connected = false; session?.close(); this.emitState("idle"); }
  mute(muted: boolean) { this.session?.mute(muted); }
  onState(listener: (state: VoiceState) => void) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcriptListeners.add(listener); return () => this.transcriptListeners.delete(listener); }
  onFailure(listener: (failure: VoiceConnectionFailure) => void) { this.failureListeners.add(listener); return () => this.failureListeners.delete(listener); }
  private emitState(state: VoiceState) { this.currentState = state; this.stateListeners.forEach((listener) => listener(state)); }
  private emitTranscript(transcript: TranscriptState) { this.transcriptListeners.forEach((listener) => listener(transcript)); }
  private emitFailure(failure: VoiceConnectionFailure) { this.failureListeners.forEach((listener) => listener(failure)); }
}

export class MockVoiceSessionAdapter implements VoiceSessionAdapter {
  private readonly stateListeners = new Set<(state: VoiceState) => void>();
  private readonly transcriptListeners = new Set<(transcript: TranscriptState) => void>();
  private readonly failureListeners = new Set<(failure: VoiceConnectionFailure) => void>();
  private timers: number[] = [];
  constructor(private readonly autoSubmit = false) {}
  async connect() {
    this.stateListeners.forEach((listener) => listener("connecting"));
    this.timers.push(window.setTimeout(() => this.stateListeners.forEach((listener) => listener("listening")), 300));
    if (this.autoSubmit) this.timers.push(window.setTimeout(() => this.submitDemoTurn(), 1050));
  }
  submitDemoTurn() {
    this.stateListeners.forEach((listener) => listener("thinking"));
    this.transcriptListeners.forEach((listener) => listener({ role: "user", text: "Gallery this afternoon, dinner tonight, lots of walking, and no dresses.", final: true }));
  }
  async disconnect() { this.timers.forEach(window.clearTimeout); this.timers = []; this.stateListeners.forEach((listener) => listener("idle")); }
  mute() {}
  onState(listener: (state: VoiceState) => void) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcriptListeners.add(listener); return () => this.transcriptListeners.delete(listener); }
  onFailure(listener: (failure: VoiceConnectionFailure) => void) { this.failureListeners.add(listener); return () => this.failureListeners.delete(listener); }
}
