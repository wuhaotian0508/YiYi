import { z } from "zod";
import { RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import { ApiErrorSchema, DailyIntentSchema, OutfitSlotSchema, PreferenceDeltaSchema, type PreferenceDelta } from "@/domain/schemas";
import { realtimeAgentInstructions } from "@/prompts/realtime-agent";
import { logVoiceDiagnostic, type VoiceDiagnostic } from "@/lib/realtime/voice-diagnostics";
import { VoiceTurnController, type VoiceTurnState } from "@/lib/realtime/voice-turn-controller";

export type VoiceState = VoiceTurnState;
export type TranscriptState = { role: "user" | "assistant"; text: string; final: boolean };
export type VoiceFailureStage = "permission" | "token" | "session" | "webrtc" | "ready" | "tool" | "recommendation" | "mutation" | "persistence" | "audio" | "cleanup" | "lifecycle";

export class VoiceConnectionFailure extends Error {
  readonly stage: VoiceFailureStage;
  readonly code: string;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly errorType?: string;
  readonly zodIssuePaths?: string[];

  constructor(input: { stage: VoiceFailureStage; code: string; httpStatus?: number; retryAfterMs?: number; errorType?: string; zodIssuePaths?: string[]; message?: string }) {
    super(input.message ?? input.code);
    this.name = "VoiceConnectionFailure";
    this.stage = input.stage;
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.retryAfterMs = input.retryAfterMs;
    this.errorType = input.errorType;
    this.zodIssuePaths = input.zodIssuePaths;
  }
}

export interface VoiceSessionAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  mute(muted: boolean): void;
  commitTurn?(): void;
  interruptAndListen?(): void;
  onState(listener: (state: VoiceState) => void): () => void;
  onTranscript(listener: (transcript: TranscriptState) => void): () => void;
  onFailure(listener: (failure: VoiceConnectionFailure) => void): () => void;
  submitDemoTurn?(): void;
}

export type VoiceToolResult = {
  success: boolean;
  summary: string;
  failureStage?: "tool" | "recommendation" | "persistence" | "lifecycle";
  errorCode?: string;
  zodIssuePaths?: string[];
  changedSlots?: string[];
  removedItemIds?: string[];
  addedItemIds?: string[];
  outfitVersionId?: string;
};

export const VoiceTurnActionSchema = z.object({
  action: z.enum(["revise", "remove", "random", "undo", "confirm", "set_availability", "save_preference", "no_change"]),
  userRequest: z.string().min(1).max(300),
  targetSlot: OutfitSlotSchema.nullable(),
  targetDescription: z.string().max(80).nullable(),
  availability: z.enum(["available", "laundry", "unavailable"]).nullable(),
}).strict();
export type VoiceTurnAction = z.infer<typeof VoiceTurnActionSchema>;

export type VoiceToolHandlers = {
  requestRecommendation(intent: z.infer<typeof DailyIntentSchema>): Promise<VoiceToolResult>;
  handleTurn(input: VoiceTurnAction): Promise<VoiceToolResult>;
  savePreference(input: PreferenceDelta): Promise<VoiceToolResult>;
};

export type VoiceAdapterOptions = {
  attemptId?: string;
  sessionGeneration?: number;
  purpose?: "today" | "fine-tune";
  requireInitialRecommendation?: boolean;
  diagnostic?: (diagnostic: VoiceDiagnostic) => void;
  now?: () => number;
};

export function resolveAvailabilityItemId(explicitItemId: string | null, focusedItemId: string | null) {
  return explicitItemId ?? focusedItemId;
}

export const yiyiTurnDetection = {
  type: "semantic_vad",
  eagerness: "auto",
  createResponse: true,
  interruptResponse: false,
} as const;

const INITIAL_RECOMMENDATION_TOOL = "request_outfit_recommendation";
const INITIAL_TOOL_WATCHDOG_MS = 12_000;

const VoiceToolResultSchema = z.object({
  success: z.boolean(),
  summary: z.string(),
  failureStage: z.enum(["tool", "recommendation", "persistence", "lifecycle"]).optional(),
  errorCode: z.string().optional(),
  zodIssuePaths: z.array(z.string()).optional(),
  changedSlots: z.array(z.string()).optional(),
  removedItemIds: z.array(z.string()).optional(),
  addedItemIds: z.array(z.string()).optional(),
  outfitVersionId: z.string().uuid().optional(),
}).passthrough();

function parseVoiceToolResult(result: string) {
  try { return VoiceToolResultSchema.safeParse(JSON.parse(result)); }
  catch { return VoiceToolResultSchema.safeParse(null); }
}

export function classifyRealtimeSessionFailure(event: unknown, connected: boolean, currentState: VoiceState) {
  const rawError = event && typeof event === "object" && "error" in event ? (event as { error: unknown }).error : event;
  const errorType = rawError instanceof Error ? rawError.name : typeof rawError;
  if (rawError instanceof z.ZodError) {
    return new VoiceConnectionFailure({
      stage: "tool",
      code: "TOOL_ARGUMENTS_INVALID",
      errorType,
      zodIssuePaths: rawError.issues.map((issue) => issue.path.join(".") || "<root>"),
    });
  }
  if (rawError instanceof SyntaxError) {
    return new VoiceConnectionFailure({ stage: "tool", code: "TOOL_ARGUMENTS_INVALID", errorType });
  }
  if (!connected) return new VoiceConnectionFailure({ stage: "ready", code: "SESSION_READY_FAILED", errorType });
  if (currentState === "speaking") return new VoiceConnectionFailure({ stage: "audio", code: "AUDIO_OUTPUT_FAILED", errorType });
  return new VoiceConnectionFailure({ stage: "tool", code: "REALTIME_TOOL_FAILED", errorType });
}

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

const InitialRecommendationVoiceSchema = DailyIntentSchema.extend({
  activities: DailyIntentSchema.shape.activities.default([]),
  aestheticTerms: DailyIntentSchema.shape.aestheticTerms.default([]),
  excludedCategories: DailyIntentSchema.shape.excludedCategories.default([]),
  excludedItemIds: DailyIntentSchema.shape.excludedItemIds.default([]),
  requiredItemIds: DailyIntentSchema.shape.requiredItemIds.default([]),
  temporaryPreferences: DailyIntentSchema.shape.temporaryPreferences.default([]),
  temporaryItemRules: DailyIntentSchema.shape.temporaryItemRules.default([]),
  freeformSummary: DailyIntentSchema.shape.freeformSummary.min(1),
}).strict();

function safeToolError(error: unknown): VoiceToolResult {
  const zodError = error instanceof z.ZodError ? error : null;
  return {
    success: false,
    summary: "I couldn’t safely understand that request. Please try once more.",
    failureStage: "tool",
    errorCode: zodError ? "TOOL_ARGUMENTS_INVALID" : "TOOL_EXECUTION_FAILED",
    ...(zodError ? { zodIssuePaths: zodError.issues.map((issue) => issue.path.join(".") || "<root>") } : {}),
  };
}

function strictRealtimeTool<TSchema extends z.ZodType>(input: {
  name: string;
  description: string;
  schema: TSchema;
  timeoutMs: number;
  execute(value: z.infer<TSchema>): Promise<VoiceToolResult>;
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
    errorFunction: (_context, error) => JSON.stringify(safeToolError(error)),
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
    strictRealtimeTool({ name: "request_outfit_recommendation", description: "Select one decisive outfit from an internal pool of legal candidates. Extract only what the user said; omitted lists and priorities receive safe application defaults. Put an explicitly requested available wardrobe item ID in requiredItemIds.", schema: InitialRecommendationVoiceSchema, timeoutMs: 25_000, execute: (input) => handlers.requestRecommendation(input) }),
    strictRealtimeTool({ name: "handle_outfit_turn", description: "Route every follow-up turn through one verified application action. Supply the user's concise request, an optional semantic target slot/description, and availability only for an availability action. Use no_change for background speech or conversation that should not mutate the outfit.", schema: VoiceTurnActionSchema, timeoutMs: 25_000, execute: (input) => handlers.handleTurn(input) }),
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
  private readonly turnController: VoiceTurnController;
  private connected = false;
  private initialRecommendationPending: boolean;
  private initialTurnCommitted = false;
  private initialToolStarted = false;
  private initialToolWatchdog: ReturnType<typeof setTimeout> | null = null;
  private followupToolWatchdog: ReturnType<typeof setTimeout> | null = null;
  private turnAwaitingTool = false;
  private readonly transcriptSignatures: Record<TranscriptState["role"], string> = { user: "", assistant: "" };
  private readonly diagnostic: (diagnostic: VoiceDiagnostic) => void;
  private readonly now: () => number;
  private readonly startedAt: number;
  private speechStoppedAt: number | undefined;

  constructor(private readonly handlers: VoiceToolHandlers, private readonly options: VoiceAdapterOptions = {}) {
    this.initialRecommendationPending = options.requireInitialRecommendation === true;
    this.diagnostic = options.diagnostic ?? (process.env.NODE_ENV === "test" ? () => undefined : logVoiceDiagnostic);
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.turnController = new VoiceTurnController({
      publish: (state) => this.publishState(state),
      setMicrophoneMuted: (muted) => this.session?.mute(muted),
    });
  }

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
    this.turnController.connecting();
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
      let followupInvocation: Promise<VoiceToolResult> | null = null;
      const sessionHandlers: VoiceToolHandlers = {
        ...this.handlers,
        handleTurn: (input) => {
          followupInvocation ??= this.handlers.handleTurn(input);
          return followupInvocation;
        },
      };
      let agentTools;
      try { agentTools = createRealtimeVoiceTools(sessionHandlers, this.options.purpose); }
      catch (error) { throw new VoiceConnectionFailure({ stage: "session", code: "TOOL_DEFINITION_FAILED", errorType: error instanceof Error ? error.name : "UnknownError" }); }
      const fineTuneInstructions = "Listen for explicit, lasting clothing or style preferences. For each distinct preference, call save_explicit_preference with a complete structured delta. Example: 'I usually prefer silver jewelry' is attribute metal, value silver, polarity more, soft strength, jewelry category and slot. 'I usually avoid black and white together' is one combination signal with both values, never two color bans. Do not infer the opposite preference, turn uncertainty into a hard rule, or save today's temporary needs. Only say it was added after the tool returns success. Do not recommend an outfit.";
      const instructions = this.options.purpose === "fine-tune" ? fineTuneInstructions : realtimeAgentInstructions;
      let runtimeAgent: RealtimeAgent;
      let initialAgent: RealtimeAgent;
      try {
        runtimeAgent = new RealtimeAgent({ name: "YiYi", voice: token.voice, instructions, tools: agentTools });
        if (this.initialRecommendationPending) {
          const recommendationTool = agentTools.find((candidate) => candidate.name === INITIAL_RECOMMENDATION_TOOL);
          if (!recommendationTool) throw new Error("Initial recommendation tool is unavailable.");
          initialAgent = new RealtimeAgent({ name: "YiYi", voice: token.voice, instructions, tools: [recommendationTool] });
        } else {
          initialAgent = runtimeAgent;
        }
      }
      catch (error) { throw new VoiceConnectionFailure({ stage: "session", code: "AGENT_CONSTRUCTION_FAILED", errorType: error instanceof Error ? error.name : "UnknownError" }); }
      try {
        session = new RealtimeSession(initialAgent, {
          model: token.model,
          transport: "webrtc",
          tracingDisabled: true,
          historyStoreAudio: false,
          config: {
            audio: { input: { turnDetection: yiyiTurnDetection } },
            ...(this.options.purpose === "today" ? { toolChoice: "required" as const } : {}),
          },
        });
      } catch (error) { throw new VoiceConnectionFailure({ stage: "session", code: "SESSION_CONSTRUCTION_FAILED", errorType: error instanceof Error ? error.name : "UnknownError" }); }
      this.session = session;
      const isActive = () => this.session === session && generation === this.connectGeneration;
      session.on("audio_start", () => {
        if (!isActive()) return;
        const audioStartedAt = this.now();
        this.record("audio", "started", { audioStartedAt, speechStoppedAt: this.speechStoppedAt });
        this.turnController.audioStarted();
      });
      session.on("audio_stopped", () => {
        if (!isActive()) return;
        const activeSession = session;
        if (!activeSession) return;
        if (this.turnAwaitingTool || (this.initialRecommendationPending && this.initialTurnCommitted)) {
          this.turnController.awaitingTool();
          return;
        }
        if (this.options.purpose === "today") activeSession.transport.updateSessionConfig({ toolChoice: "required" });
        this.turnController.audioStopped();
        followupInvocation = null;
      });
      session.on("audio_interrupted", () => { if (isActive() && this.currentState === "speaking") this.turnController.audioStopped(); });
      session.on("agent_start", () => { if (isActive()) this.turnController.agentStarted(); });
      session.on("agent_tool_start", (_context, _agent, activeTool) => {
        const activeSession = session;
        if (!isActive() || !activeSession) return;
        const toolStartAt = this.now();
        if (this.initialRecommendationPending && !this.initialToolStarted && activeTool.name === INITIAL_RECOMMENDATION_TOOL) {
          this.initialToolStarted = true;
          this.clearInitialToolWatchdog();
        }
        this.clearFollowupToolWatchdog();
        // Require exactly one application action per committed turn, then let
        // the model speak from its verified result without forcing a tool loop.
        if (this.options.purpose === "today") activeSession.transport.updateSessionConfig({ toolChoice: "auto" });
        this.record("tool", "started", { toolName: activeTool.name, toolStartAt, speechStoppedAt: this.speechStoppedAt });
        this.turnController.toolStarted(activeTool.name);
      });
      session.on("agent_tool_end", (_context, _agent, activeTool, result) => {
        if (!isActive()) return;
        const activeSession = session;
        if (!activeSession) return;
        const toolEndAt = this.now();
        const parsed = parseVoiceToolResult(result);
        const success = parsed.success && parsed.data.success;
        this.turnAwaitingTool = false;
        this.record("tool", success ? "success" : "error", {
          toolName: activeTool.name,
          toolEndAt,
          success,
          speechStoppedAt: this.speechStoppedAt,
          ...(success && parsed.success && parsed.data.outfitVersionId ? { outfitCommittedAt: toolEndAt } : {}),
          ...(!success && parsed.success ? { errorCode: parsed.data.errorCode, zodIssuePaths: parsed.data.zodIssuePaths } : {}),
        });
        if (success && parsed.success && parsed.data.outfitVersionId) this.record("mutation", "success", { outfitCommittedAt: toolEndAt, outfitVersionId: parsed.data.outfitVersionId });
        if (!this.initialRecommendationPending || activeTool.name !== INITIAL_RECOMMENDATION_TOOL) {
          if (success) {
            this.turnController.toolEnded(true);
            return;
          }
          const failure = new VoiceConnectionFailure({
            stage: parsed.success ? parsed.data.failureStage ?? "tool" : "tool",
            code: parsed.success ? parsed.data.errorCode ?? "VOICE_ACTION_FAILED" : "TOOL_RESULT_INVALID",
            zodIssuePaths: parsed.success ? parsed.data.zodIssuePaths : undefined,
          });
          this.emitFailure(failure);
          this.turnController.toolEnded(false);
          return;
        }
        if (success) {
          this.initialRecommendationPending = false;
          this.initialTurnCommitted = false;
          this.clearInitialToolWatchdog();
          void activeSession.updateAgent(runtimeAgent).then(() => {
            if (!isActive()) return;
          }).catch((error: unknown) => {
            if (!isActive()) return;
            const failure = new VoiceConnectionFailure({ stage: "lifecycle", code: "RUNTIME_AGENT_SWITCH_FAILED", errorType: error instanceof Error ? error.name : typeof error });
            this.emitFailure(failure);
            this.turnController.fail();
          });
          this.turnController.toolEnded(true);
          return;
        }
        const failure = new VoiceConnectionFailure({
          stage: parsed.success ? parsed.data.failureStage ?? "recommendation" : "tool",
          code: parsed.success ? parsed.data.errorCode ?? "INITIAL_RECOMMENDATION_FAILED" : "TOOL_RESULT_INVALID",
          zodIssuePaths: parsed.success ? parsed.data.zodIssuePaths : undefined,
        });
        this.emitFailure(failure);
        this.turnController.toolEnded(false);
      });
      session.on("error", (event) => {
        if (!isActive()) return;
        const failure = classifyRealtimeSessionFailure(event, this.connected, this.currentState);
        this.record(failure.stage, "error", { errorCode: failure.code, errorType: failure.errorType, zodIssuePaths: failure.zodIssuePaths });
        this.emitFailure(failure);
        this.turnController.fail();
      });
      session.on("transport_event", (event) => {
        if (!isActive()) return;
        if (event.type === "input_audio_buffer.speech_started") {
          if (this.currentState === "listening") followupInvocation = null;
          this.turnController.speechStarted();
        }
        if (event.type === "input_audio_buffer.speech_stopped") {
          if (this.currentState !== "listening") return;
          this.speechStoppedAt = this.now();
          this.initialTurnCommitted = this.initialRecommendationPending;
          this.turnAwaitingTool = true;
          this.record("recommendation", "started", { speechStoppedAt: this.speechStoppedAt });
          if (this.initialRecommendationPending && !this.initialToolStarted) this.startInitialToolWatchdog();
          else this.startFollowupToolWatchdog();
          this.turnController.speechStopped();
        }
      });
      session.transport.on("connection_change", (status) => {
        if (!isActive()) return;
        if (status === "connecting") this.turnController.connecting();
        if (status === "disconnected") {
          if (!this.connected) return;
          this.emitFailure(new VoiceConnectionFailure({ stage: "webrtc", code: "WEBRTC_DISCONNECTED" }));
          this.turnController.fail();
        }
      });
      session.on("history_updated", (history) => {
        if (!isActive()) return;
        for (const role of ["user", "assistant"] as const) {
          const latest = [...history].reverse().find((item) => item.type === "message" && item.role === role);
          if (!latest || latest.type !== "message" || latest.role !== role) continue;
          const text = latest.content.map((content) => "text" in content ? content.text : content.transcript ?? "").join(" ").trim();
          if (!text) continue;
          const final = latest.status === "completed";
          const signature = `${latest.itemId}:${latest.status}:${text}`;
          if (this.transcriptSignatures[role] === signature) continue;
          this.transcriptSignatures[role] = signature;
          this.emitTranscript({ role, text, final });
        }
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
      this.turnController.connected();
    } catch (error) {
      if (this.session === session) this.session = null;
      this.connected = false;
      session?.close();
      if (this.connectAbortController === connectAbortController) this.connectAbortController = null;
      if (connectAbortController.signal.aborted || generation !== this.connectGeneration) return;
      this.turnController.fail();
      throw error;
    }
  }

  async disconnect() { this.connectGeneration += 1; this.connectPromise = null; this.connectAbortController?.abort(); this.connectAbortController = null; this.clearInitialToolWatchdog(); this.clearFollowupToolWatchdog(); this.turnAwaitingTool = false; const session = this.session; this.session = null; this.connected = false; session?.close(); this.turnController.idle(); }
  mute(muted: boolean) { this.session?.mute(muted); }
  commitTurn() {
    this.turnController.primaryAction({
      commit: () => {
        this.turnAwaitingTool = true;
        if (this.initialRecommendationPending) {
          this.initialTurnCommitted = true;
          this.startInitialToolWatchdog();
        } else this.startFollowupToolWatchdog();
        this.record("lifecycle", "started", { turnCommittedAt: this.now() });
        this.session?.transport.sendEvent({ type: "input_audio_buffer.commit" });
        this.session?.transport.requestResponse?.();
      },
      interrupt: () => undefined,
    });
  }
  interruptAndListen() {
    this.turnController.primaryAction({ commit: () => undefined, interrupt: () => this.session?.interrupt() });
  }
  onState(listener: (state: VoiceState) => void) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcriptListeners.add(listener); return () => this.transcriptListeners.delete(listener); }
  onFailure(listener: (failure: VoiceConnectionFailure) => void) { this.failureListeners.add(listener); return () => this.failureListeners.delete(listener); }
  private publishState(state: VoiceState) { this.currentState = state; this.stateListeners.forEach((listener) => listener(state)); }
  private emitTranscript(transcript: TranscriptState) { this.transcriptListeners.forEach((listener) => listener(transcript)); }
  private emitFailure(failure: VoiceConnectionFailure) { this.failureListeners.forEach((listener) => listener(failure)); }
  private startInitialToolWatchdog() {
    this.clearInitialToolWatchdog();
    this.initialToolWatchdog = setTimeout(() => {
      this.initialToolWatchdog = null;
      if (!this.initialRecommendationPending || !this.initialTurnCommitted || this.initialToolStarted) return;
      const failure = new VoiceConnectionFailure({ stage: "recommendation", code: "INITIAL_RECOMMENDATION_TIMEOUT" });
      this.record("recommendation", "error", { errorCode: failure.code, speechStoppedAt: this.speechStoppedAt });
      this.emitFailure(failure);
      this.turnController.fail();
    }, INITIAL_TOOL_WATCHDOG_MS);
  }
  private clearInitialToolWatchdog() {
    if (this.initialToolWatchdog) clearTimeout(this.initialToolWatchdog);
    this.initialToolWatchdog = null;
  }
  private startFollowupToolWatchdog() {
    this.clearFollowupToolWatchdog();
    this.followupToolWatchdog = setTimeout(() => {
      this.followupToolWatchdog = null;
      if (!this.turnAwaitingTool || this.initialRecommendationPending) return;
      this.turnAwaitingTool = false;
      const failure = new VoiceConnectionFailure({ stage: "tool", code: "VOICE_ACTION_TIMEOUT" });
      this.record("tool", "error", { errorCode: failure.code, speechStoppedAt: this.speechStoppedAt });
      this.emitFailure(failure);
      this.turnController.fail();
    }, INITIAL_TOOL_WATCHDOG_MS);
  }
  private clearFollowupToolWatchdog() {
    if (this.followupToolWatchdog) clearTimeout(this.followupToolWatchdog);
    this.followupToolWatchdog = null;
  }
  private record(stage: VoiceFailureStage, result: VoiceDiagnostic["result"], extra: Partial<VoiceDiagnostic> = {}) {
    if (!this.options.attemptId || this.options.sessionGeneration === undefined) return;
    this.diagnostic({
      voiceAttemptId: this.options.attemptId,
      sessionGeneration: this.options.sessionGeneration,
      owner: this.options.purpose ?? "today",
      stage,
      result,
      durationMs: this.now() - this.startedAt,
      retryCount: 0,
      ...extra,
    });
  }
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
    this.stateListeners.forEach((listener) => listener("understanding"));
    this.transcriptListeners.forEach((listener) => listener({ role: "user", text: "Gallery this afternoon, dinner tonight, lots of walking, and no dresses.", final: true }));
    this.stateListeners.forEach((listener) => listener("listening"));
  }
  async disconnect() { this.timers.forEach(window.clearTimeout); this.timers = []; this.stateListeners.forEach((listener) => listener("idle")); }
  mute() {}
  commitTurn() { this.submitDemoTurn(); }
  interruptAndListen() { this.stateListeners.forEach((listener) => listener("listening")); }
  onState(listener: (state: VoiceState) => void) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcriptListeners.add(listener); return () => this.transcriptListeners.delete(listener); }
  onFailure(listener: (failure: VoiceConnectionFailure) => void) { this.failureListeners.add(listener); return () => this.failureListeners.delete(listener); }
}
