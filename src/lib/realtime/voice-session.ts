import { z } from "zod";
import { OpenAIRealtimeWebRTC, RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import { ApiErrorSchema, OutfitSlotSchema, PreferenceDeltaSchema, type PreferenceDelta } from "@/domain/schemas";
import { InitialRecommendationVoiceRequestSchema, type InitialRecommendationVoiceRequest } from "@/domain/recommendation/voice-intent";
import { realtimeAgentInstructions } from "@/prompts/realtime-agent";
import { logVoiceDiagnostic, type VoiceDiagnostic } from "@/lib/realtime/voice-diagnostics";
import { VoiceTurnController, type VoiceTurnState } from "@/lib/realtime/voice-turn-controller";
import { resetVoiceAudioEnergy, startVoiceAudioEnergySampler } from "@/lib/realtime/audio-energy";
import { providerSessionHeaders } from "@/lib/api/client-session";
import { DEFAULT_REALTIME_TRANSCRIPTION_MODEL } from "@/lib/realtime/config";

export type VoiceState = VoiceTurnState;
export type TranscriptState = { role: "user" | "assistant"; text: string; final: boolean };
export type TranscriptCapabilityStatus = "pending" | "configured" | "receiving" | "failed" | "unavailable";
export type VoiceFailureStage = "permission" | "token" | "session" | "webrtc" | "ready" | "tool" | "recommendation" | "mutation" | "persistence" | "audio" | "cleanup" | "lifecycle";

export class VoiceConnectionFailure extends Error {
  readonly stage: VoiceFailureStage;
  readonly code: string;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly errorType?: string;
  readonly zodIssuePaths?: string[];
  readonly requestId?: string;

  constructor(input: { stage: VoiceFailureStage; code: string; httpStatus?: number; retryAfterMs?: number; errorType?: string; zodIssuePaths?: string[]; requestId?: string; message?: string }) {
    super(input.message ?? input.code);
    this.name = "VoiceConnectionFailure";
    this.stage = input.stage;
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.retryAfterMs = input.retryAfterMs;
    this.errorType = input.errorType;
    this.zodIssuePaths = input.zodIssuePaths;
    this.requestId = input.requestId;
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
  onTranscriptStatus?(listener: (status: TranscriptCapabilityStatus) => void): () => void;
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
  requestRecommendation(request: InitialRecommendationVoiceRequest): Promise<VoiceToolResult>;
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
  // Product code owns response creation so a committed turn cannot produce a
  // conversational reply without also entering the required application tool.
  createResponse: false,
  interruptResponse: false,
} as const;

const INITIAL_RECOMMENDATION_TOOL = "request_outfit_recommendation";
// Independent progress deadlines: each starts only after the preceding server
// acknowledgement, so transport latency cannot consume the tool's budget.
const RESPONSE_CREATE_ACK_TIMEOUT_MS = 10_000;
const FUNCTION_CALL_START_TIMEOUT_MS = 25_000;
const TOOL_DISPATCH_TIMEOUT_MS = 10_000;
const TOOL_EXECUTION_TIMEOUT_MS = 45_000;
// One outfit turn renders candidate boards, waits on listwise visual ranking, and
// commits a version. Ranking alone measured up to 18.5s, so the tool budget sits
// above it while staying under the adapter's execution watchdog.
const OUTFIT_TOOL_TIMEOUT_MS = 40_000;

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
  // RealtimeSession wraps provider events once more before emitting them. Keep
  // only the provider's stable code/type, never its message (which can contain
  // request-specific content), so the UI and diagnostics can identify a
  // rejected session configuration without exposing conversation data.
  const outerError = event && typeof event === "object" && "error" in event ? (event as { error: unknown }).error : event;
  const nestedError = objectRecord(outerError)?.error;
  const rawError = nestedError ?? outerError;
  const providerError = objectRecord(rawError);
  const providerCode = safeRealtimeProviderValue(providerError?.code);
  const providerType = safeRealtimeProviderValue(providerError?.type);
  const errorType = providerType ?? (rawError instanceof Error ? rawError.name : typeof rawError);
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
  if (!connected) return new VoiceConnectionFailure({ stage: "ready", code: providerCode ?? "SESSION_READY_FAILED", errorType });
  if (currentState === "speaking") return new VoiceConnectionFailure({ stage: "audio", code: "AUDIO_OUTPUT_FAILED", errorType });
  return new VoiceConnectionFailure({ stage: "tool", code: "REALTIME_TOOL_FAILED", errorType });
}

function safeRealtimeProviderValue(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[a-z0-9_]{1,80}$/i.test(trimmed) ? trimmed : undefined;
}

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

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
    strictRealtimeTool({ name: "request_outfit_recommendation", description: "Start the required first outfit transaction. Return the user's concise original request plus short activity, feeling, exclusion, and semantic wardrobe-anchor phrases. Never invent local IDs, confidence, ambiguity, priorities, or internal constraints. wardrobeAnchors contains only items the user explicitly asked to wear, keep, include, or use.", schema: InitialRecommendationVoiceRequestSchema, timeoutMs: OUTFIT_TOOL_TIMEOUT_MS, execute: (input) => handlers.requestRecommendation(input) }),
    strictRealtimeTool({ name: "handle_outfit_turn", description: "Route every follow-up turn through one verified application action. Supply the user's concise request, an optional semantic target slot/description, and availability only for an availability action. Use no_change for background speech or conversation that should not mutate the outfit.", schema: VoiceTurnActionSchema, timeoutMs: OUTFIT_TOOL_TIMEOUT_MS, execute: (input) => handlers.handleTurn(input) }),
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
  private readonly transcriptStatusListeners = new Set<(status: TranscriptCapabilityStatus) => void>();
  private readonly failureListeners = new Set<(failure: VoiceConnectionFailure) => void>();
  private currentState: VoiceState = "idle";
  private readonly turnController: VoiceTurnController;
  private connected = false;
  private initialRecommendationPending: boolean;
  private initialTurnCommitted = false;
  private initialToolStarted = false;
  private responseAckWatchdog: ReturnType<typeof setTimeout> | null = null;
  private functionCallWatchdog: ReturnType<typeof setTimeout> | null = null;
  private toolDispatchWatchdog: ReturnType<typeof setTimeout> | null = null;
  private toolExecutionWatchdog: ReturnType<typeof setTimeout> | null = null;
  private turnAwaitingTool = false;
  private turnResponseRequested = false;
  private readonly transcriptSignatures: Record<TranscriptState["role"], string> = { user: "", assistant: "" };
  private readonly partialInputTranscripts = new Map<string, string>();
  private readonly inputTranscriptItemOrder = new Map<string, number>();
  private inputTranscriptSequence = 0;
  private activeInputTranscriptItemId: string | null = null;
  private readonly diagnostic: (diagnostic: VoiceDiagnostic) => void;
  private readonly now: () => number;
  private readonly startedAt: number;
  private speechStoppedAt: number | undefined;
  private stopAudioEnergySampler: (() => void) | null = null;
  private tokenRequestId: string | undefined;
  private effectiveSessionReady = false;
  private activeResponseId: string | null = null;

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
    this.effectiveSessionReady = false;
    this.activeResponseId = null;
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
            ...providerSessionHeaders(),
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
          requestId: parsedError.success ? parsedError.data.requestId : undefined,
        });
      }
      if (generation !== this.connectGeneration || connectAbortController.signal.aborted) return;
      const parsedToken = z.object({
        requestId: z.string().uuid().default(() => crypto.randomUUID()),
        value: z.string().min(1),
        model: z.string().min(1),
        transcriptionModel: z.string().min(1).default(DEFAULT_REALTIME_TRANSCRIPTION_MODEL),
        voice: z.string().min(1),
      }).safeParse(payload);
      if (!parsedToken.success) throw new VoiceConnectionFailure({ stage: "token", code: "TOKEN_RESPONSE_INVALID", httpStatus: response.status });
      const token = parsedToken.data;
      this.tokenRequestId = token.requestId;
      let followupInvocation: Promise<VoiceToolResult> | null = null;
      const sessionHandlers: VoiceToolHandlers = {
        ...this.handlers,
        requestRecommendation: (input) => this.handlers.requestRecommendation(input),
        handleTurn: (input) => {
          this.record("tool", "started", { toolName: "handle_outfit_turn", voiceAction: input.action });
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
        const transport = new OpenAIRealtimeWebRTC();
        session = new RealtimeSession(initialAgent, {
          model: token.model,
          transport,
          tracingDisabled: true,
          historyStoreAudio: false,
          config: {
            audio: {
              input: {
                transcription: { model: token.transcriptionModel },
                turnDetection: yiyiTurnDetection,
              },
            },
          },
        });
      } catch (error) { throw new VoiceConnectionFailure({ stage: "session", code: "SESSION_CONSTRUCTION_FAILED", errorType: error instanceof Error ? error.name : "UnknownError" }); }
      this.session = session;
      const isActive = () => this.session === session && generation === this.connectGeneration;
      let realtimeSessionFailure: VoiceConnectionFailure | null = null;
      let sessionUpdateObserved = false;
      let resolveSessionUpdate: (() => void) | null = null;
      const sessionUpdateAcknowledged = new Promise<void>((resolve) => { resolveSessionUpdate = resolve; });
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
        this.turnController.audioStopped();
        followupInvocation = null;
      });
      session.on("audio_interrupted", () => {
        if (!isActive()) return;
        if (this.currentState === "speaking" || this.currentState === "interrupted") this.turnController.audioStopped();
      });
      session.on("agent_start", () => { if (isActive()) this.turnController.agentStarted(); });
      session.on("agent_tool_start", (_context, _agent, activeTool) => {
        const activeSession = session;
        if (!isActive() || !activeSession) return;
        const toolStartAt = this.now();
        if (this.initialRecommendationPending && !this.initialToolStarted && activeTool.name === INITIAL_RECOMMENDATION_TOOL) {
          this.initialToolStarted = true;
        }
        this.clearResponseWatchdogs();
        this.startToolExecutionWatchdog();
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
        this.clearToolExecutionWatchdog();
        const parsed = parseVoiceToolResult(result);
        const success = parsed.success && parsed.data.success;
        this.turnAwaitingTool = false;
        this.turnResponseRequested = false;
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
          this.clearResponseWatchdogs();
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
        realtimeSessionFailure = failure;
        this.record(failure.stage, "error", { errorCode: failure.code, errorType: failure.errorType, zodIssuePaths: failure.zodIssuePaths });
        this.emitFailure(failure);
        this.turnController.fail();
      });
      session.on("transport_event", (event) => {
        if (!isActive()) return;
        if (event.type === "session.updated") {
          sessionUpdateObserved = true;
          const sessionPayload = objectRecord(event.session);
          const tools = Array.isArray(sessionPayload?.tools) ? sessionPayload.tools : [];
          const toolNames = tools.flatMap((entry) => {
            const toolEntry = objectRecord(entry);
            return typeof toolEntry?.name === "string" ? [toolEntry.name] : [];
          });
          const audio = objectRecord(sessionPayload?.audio);
          const input = objectRecord(audio?.input);
          const transcription = objectRecord(input?.transcription);
          const turnDetection = objectRecord(input?.turn_detection);
          const expectedTool = this.options.purpose === "fine-tune" ? "save_explicit_preference" : INITIAL_RECOMMENDATION_TOOL;
          const responseOwnedByApplication = turnDetection?.create_response === false && turnDetection?.interrupt_response === false;
          const effectiveVadType = typeof turnDetection?.type === "string" ? turnDetection.type : undefined;
          const effectiveTranscriptionModel = typeof transcription?.model === "string" ? transcription.model : undefined;
          const transcriptConfigured = Boolean(effectiveTranscriptionModel);
          // `response.create` below owns the Today turn and explicitly requires
          // an application tool. Keeping the initial session in the provider's
          // default tool-choice mode avoids rejecting an otherwise valid WebRTC
          // session before the first committed user turn.
          const effectiveReady = responseOwnedByApplication && effectiveVadType === "semantic_vad" && toolNames.includes(expectedTool);
          if (!this.connected) this.effectiveSessionReady = effectiveReady;
          this.publishTranscriptStatus(transcriptConfigured ? "configured" : "unavailable");
          this.record("ready", effectiveReady ? "success" : "error", {
            realtimeEvent: event.type,
            effectiveToolChoice: typeof sessionPayload?.tool_choice === "string" ? sessionPayload.tool_choice : undefined,
            effectiveToolNames: toolNames,
            effectiveVadType,
            effectiveTranscriptionModel,
            transcriptStatus: transcriptConfigured ? "configured" : "unavailable",
            effectiveCreateResponse: typeof turnDetection?.create_response === "boolean" ? turnDetection.create_response : undefined,
            effectiveInterruptResponse: typeof turnDetection?.interrupt_response === "boolean" ? turnDetection.interrupt_response : undefined,
            ...(!effectiveReady ? { errorCode: "SESSION_CONFIG_MISMATCH" } : {}),
          });
          resolveSessionUpdate?.();
          resolveSessionUpdate = null;
        }
        if (event.type === "response.created") {
          this.clearResponseAckWatchdog();
          if (this.turnAwaitingTool) this.startFunctionCallWatchdog();
          const response = objectRecord(event.response);
          this.activeResponseId = typeof response?.id === "string" ? response.id : null;
          this.record("recommendation", "success", {
            realtimeEvent: event.type,
            responseId: typeof response?.id === "string" ? response.id : undefined,
            responseStatus: typeof response?.status === "string" ? response.status : undefined,
          });
        }
        if (event.type === "response.output_item.added") {
          if (this.activeResponseId && event.response_id !== this.activeResponseId) return;
          const item = objectRecord(event.item);
          const outputItemType = typeof item?.type === "string" ? item.type : undefined;
          const toolName = typeof item?.name === "string" ? item.name : undefined;
          if (outputItemType === "function_call") {
            this.clearFunctionCallWatchdog();
            this.startToolDispatchWatchdog();
          }
          this.record("tool", "started", { realtimeEvent: event.type, outputItemType, toolName });
        }
        if (event.type === "response.function_call_arguments.done") {
          if (this.activeResponseId && event.response_id !== this.activeResponseId) return;
          this.record("tool", "success", {
            realtimeEvent: event.type,
            toolName: event.name,
            argumentBytes: new TextEncoder().encode(event.arguments).byteLength,
          });
        }
        if (event.type === "response.done") {
          const response = objectRecord(event.response);
          const responseId = typeof response?.id === "string" ? response.id : undefined;
          if (this.activeResponseId && responseId !== this.activeResponseId) return;
          const output = Array.isArray(response?.output) ? response.output : [];
          const outputTypes = output.flatMap((entry) => {
            const outputItem = objectRecord(entry);
            return typeof outputItem?.type === "string" ? [outputItem.type] : [];
          });
          const responseStatus = typeof response?.status === "string" ? response.status : undefined;
          this.record("recommendation", responseStatus === "failed" ? "error" : "success", {
            realtimeEvent: event.type,
            responseId,
            responseStatus,
            outputItemType: outputTypes.join(",") || undefined,
          });
          if (this.turnAwaitingTool && !outputTypes.includes("function_call")) {
            this.failPendingTurn(this.initialRecommendationPending ? "INITIAL_RECOMMENDATION_TOOL_MISSING" : "VOICE_ACTION_TOOL_MISSING");
          }
          this.activeResponseId = null;
        }
        if (event.type === "input_audio_buffer.speech_started") {
          if (this.currentState === "listening") {
            followupInvocation = null;
            this.turnResponseRequested = false;
          }
          const itemId = typeof event.item_id === "string" ? event.item_id : null;
          if (itemId) this.isCurrentInputTranscriptItem(itemId, true);
          this.turnController.speechStarted();
        }
        if (event.type === "input_audio_buffer.speech_stopped") {
          if (this.currentState !== "listening") return;
          this.speechStoppedAt = this.now();
          this.initialTurnCommitted = this.initialRecommendationPending;
          this.turnAwaitingTool = true;
          this.record("recommendation", "started", { speechStoppedAt: this.speechStoppedAt });
          this.turnController.speechStopped();
          this.requestApplicationResponse();
        }
        if (event.type === "conversation.item.input_audio_transcription.completed") {
          const text = event.transcript.trim();
          if (!text) return;
          this.partialInputTranscripts.delete(event.item_id);
          if (!this.isCurrentInputTranscriptItem(event.item_id, true)) return;
          const signature = `${event.item_id}:completed:${text}`;
          if (this.transcriptSignatures.user === signature) return;
          this.transcriptSignatures.user = signature;
          this.emitTranscript({ role: "user", text, final: true });
          this.publishTranscriptStatus("receiving");
          this.record("audio", "success", { realtimeEvent: event.type, transcriptStatus: "receiving" });
        }
        if (event.type === "conversation.item.input_audio_transcription.delta") {
          const delta = event.delta.trim();
          if (!delta) return;
          if (!this.isCurrentInputTranscriptItem(event.item_id, true)) return;
          const prior = this.partialInputTranscripts.get(event.item_id) ?? "";
          const separator = prior && !/\s$/.test(prior) && !/^\s/.test(delta) && /[A-Za-z0-9]$/.test(prior) && /^[A-Za-z0-9]/.test(delta) ? " " : "";
          const text = `${prior}${separator}${delta}`.trim();
          this.partialInputTranscripts.set(event.item_id, text);
          const signature = `${event.item_id}:partial:${text}`;
          if (this.transcriptSignatures.user === signature) return;
          this.transcriptSignatures.user = signature;
          this.emitTranscript({ role: "user", text, final: false });
          this.publishTranscriptStatus("receiving");
        }
        if (event.type === "conversation.item.input_audio_transcription.failed") {
          const error = objectRecord(event.error);
          if (this.isCurrentInputTranscriptItem(event.item_id, true)) this.publishTranscriptStatus("failed");
          this.record("audio", "error", {
            realtimeEvent: event.type,
            errorCode: typeof error?.code === "string" ? error.code : "INPUT_TRANSCRIPTION_FAILED",
            errorType: typeof error?.type === "string" ? error.type : undefined,
            transcriptStatus: "failed",
          });
        }
      });
      session.transport.on("connection_change", (status) => {
        const activeSession = session;
        if (!isActive() || !activeSession) return;
        if (status === "connecting") this.turnController.connecting();
        if (status === "connected") this.startAudioEnergySamplerIfConnected(activeSession);
        if (status === "disconnected") {
          this.stopAudioEnergySampler?.();
          this.stopAudioEnergySampler = null;
          if (!this.connected) return;
          this.emitFailure(new VoiceConnectionFailure({ stage: "webrtc", code: "WEBRTC_DISCONNECTED" }));
          this.turnController.fail();
        }
      });
      session.on("history_updated", (history) => {
        if (!isActive()) return;
        for (const role of ["assistant"] as const) {
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
        if (realtimeSessionFailure) throw realtimeSessionFailure;
        const awaitingReady = error instanceof Error && /session config|acknowledged/i.test(error.message);
        throw new VoiceConnectionFailure({ stage: awaitingReady ? "ready" : "webrtc", code: awaitingReady ? "SESSION_READY_FAILED" : "WEBRTC_CONNECT_FAILED", errorType: error instanceof Error ? error.name : typeof error });
      }
      if (!isActive()) { session.close(); return; }
      if (!sessionUpdateObserved) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 2_000);
          void sessionUpdateAcknowledged.then(() => { clearTimeout(timeout); resolve(); });
        });
      }
      if (!isActive()) { session.close(); return; }
      if (!this.effectiveSessionReady) {
        throw new VoiceConnectionFailure({ stage: "ready", code: sessionUpdateObserved ? "SESSION_CONFIG_MISMATCH" : "SESSION_CONFIG_UNCONFIRMED", requestId: this.tokenRequestId });
      }
      this.connected = true;
      this.startAudioEnergySamplerIfConnected(session);
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

  async disconnect() { this.connectGeneration += 1; this.connectPromise = null; this.connectAbortController?.abort(); this.connectAbortController = null; this.clearResponseWatchdogs(); this.clearToolExecutionWatchdog(); this.turnAwaitingTool = false; this.turnResponseRequested = false; this.activeResponseId = null; this.effectiveSessionReady = false; this.partialInputTranscripts.clear(); this.inputTranscriptItemOrder.clear(); this.inputTranscriptSequence = 0; this.activeInputTranscriptItemId = null; this.stopAudioEnergySampler?.(); this.stopAudioEnergySampler = null; resetVoiceAudioEnergy(); const session = this.session; this.session = null; this.connected = false; session?.close(); this.turnController.idle(); }
  mute(muted: boolean) { this.session?.mute(muted); }
  commitTurn() {
    this.turnController.primaryAction({
      commit: () => {
        this.turnAwaitingTool = true;
        if (this.initialRecommendationPending) {
          this.initialTurnCommitted = true;
        }
        this.record("lifecycle", "started", { turnCommittedAt: this.now() });
        this.session?.transport.sendEvent({ type: "input_audio_buffer.commit" });
        this.requestApplicationResponse();
      },
      interrupt: () => undefined,
    });
  }
  interruptAndListen() {
    this.turnController.primaryAction({ commit: () => undefined, interrupt: () => this.session?.interrupt() });
  }
  onState(listener: (state: VoiceState) => void) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcriptListeners.add(listener); return () => this.transcriptListeners.delete(listener); }
  onTranscriptStatus(listener: (status: TranscriptCapabilityStatus) => void) { this.transcriptStatusListeners.add(listener); return () => this.transcriptStatusListeners.delete(listener); }
  onFailure(listener: (failure: VoiceConnectionFailure) => void) { this.failureListeners.add(listener); return () => this.failureListeners.delete(listener); }
  private publishState(state: VoiceState) { this.currentState = state; this.stateListeners.forEach((listener) => listener(state)); }
  private emitTranscript(transcript: TranscriptState) { this.transcriptListeners.forEach((listener) => listener(transcript)); }
  private publishTranscriptStatus(status: TranscriptCapabilityStatus) { this.transcriptStatusListeners.forEach((listener) => listener(status)); }
  private isCurrentInputTranscriptItem(itemId: string, activateNew: boolean) {
    let order = this.inputTranscriptItemOrder.get(itemId);
    if (order === undefined) {
      order = ++this.inputTranscriptSequence;
      this.inputTranscriptItemOrder.set(itemId, order);
      if (activateNew) this.activeInputTranscriptItemId = itemId;
    }
    if (!this.activeInputTranscriptItemId) this.activeInputTranscriptItemId = itemId;
    const activeOrder = this.inputTranscriptItemOrder.get(this.activeInputTranscriptItemId) ?? 0;
    if (activateNew && order > activeOrder) this.activeInputTranscriptItemId = itemId;
    return this.activeInputTranscriptItemId === itemId;
  }
  private emitFailure(failure: VoiceConnectionFailure) { this.failureListeners.forEach((listener) => listener(failure)); }
  private requestApplicationResponse() {
    if (!this.session || this.turnResponseRequested || !this.turnAwaitingTool) return;
    if (!this.effectiveSessionReady || !this.session.transport.requestResponse) {
      this.failPendingTurn("SESSION_CONFIG_NOT_READY");
      return;
    }
    this.turnResponseRequested = true;
    this.record("lifecycle", "success", { turnCommittedAt: this.now() });
    this.startResponseAckWatchdog();
    this.session.transport.requestResponse?.({ tool_choice: "required", parallel_tool_calls: false });
  }
  private startResponseAckWatchdog() {
    this.clearResponseAckWatchdog();
    this.responseAckWatchdog = setTimeout(() => {
      this.responseAckWatchdog = null;
      if (this.turnAwaitingTool) this.failPendingTurn("REALTIME_RESPONSE_CREATE_TIMEOUT");
    }, RESPONSE_CREATE_ACK_TIMEOUT_MS);
  }
  private startFunctionCallWatchdog() {
    this.clearFunctionCallWatchdog();
    this.functionCallWatchdog = setTimeout(() => {
      this.functionCallWatchdog = null;
      if (this.turnAwaitingTool) this.failPendingTurn(this.initialRecommendationPending ? "INITIAL_FUNCTION_CALL_TIMEOUT" : "VOICE_ACTION_FUNCTION_CALL_TIMEOUT");
    }, FUNCTION_CALL_START_TIMEOUT_MS);
  }
  private startToolDispatchWatchdog() {
    if (this.toolDispatchWatchdog) clearTimeout(this.toolDispatchWatchdog);
    this.toolDispatchWatchdog = setTimeout(() => {
      this.toolDispatchWatchdog = null;
      if (this.turnAwaitingTool) this.failPendingTurn("REALTIME_TOOL_DISPATCH_TIMEOUT");
    }, TOOL_DISPATCH_TIMEOUT_MS);
  }
  private startToolExecutionWatchdog() {
    this.clearToolExecutionWatchdog();
    this.toolExecutionWatchdog = setTimeout(() => {
      this.toolExecutionWatchdog = null;
      if (this.turnAwaitingTool) this.failPendingTurn("REALTIME_TOOL_EXECUTION_TIMEOUT");
    }, TOOL_EXECUTION_TIMEOUT_MS);
  }
  private failPendingTurn(code: string) {
    if (!this.turnAwaitingTool) return;
    this.turnAwaitingTool = false;
    this.turnResponseRequested = false;
    this.activeResponseId = null;
    this.clearResponseWatchdogs();
    this.clearToolExecutionWatchdog();
    const failure = new VoiceConnectionFailure({ stage: this.initialRecommendationPending ? "recommendation" : "tool", code, requestId: this.tokenRequestId });
    this.record(failure.stage, "error", { errorCode: code, speechStoppedAt: this.speechStoppedAt });
    this.emitFailure(failure);
    this.turnController.fail();
  }
  private clearResponseAckWatchdog() {
    if (this.responseAckWatchdog) clearTimeout(this.responseAckWatchdog);
    this.responseAckWatchdog = null;
  }
  private clearFunctionCallWatchdog() {
    if (this.functionCallWatchdog) clearTimeout(this.functionCallWatchdog);
    this.functionCallWatchdog = null;
  }
  private clearResponseWatchdogs() {
    this.clearResponseAckWatchdog();
    this.clearFunctionCallWatchdog();
    if (this.toolDispatchWatchdog) clearTimeout(this.toolDispatchWatchdog);
    this.toolDispatchWatchdog = null;
  }
  private clearToolExecutionWatchdog() {
    if (this.toolExecutionWatchdog) clearTimeout(this.toolExecutionWatchdog);
    this.toolExecutionWatchdog = null;
  }
  private startAudioEnergySamplerIfConnected(session: RealtimeSession) {
    if (this.stopAudioEnergySampler) return;
    const transport = session.transport as typeof session.transport & {
      connectionState?: { status?: string; peerConnection?: RTCPeerConnection };
    };
    const connectionState = transport.connectionState;
    if (connectionState?.status !== "connected" || !connectionState.peerConnection) return;
    this.stopAudioEnergySampler = startVoiceAudioEnergySampler(connectionState.peerConnection);
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
      requestId: this.tokenRequestId,
      ...extra,
    });
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

export class MockVoiceSessionAdapter implements VoiceSessionAdapter {
  private readonly stateListeners = new Set<(state: VoiceState) => void>();
  private readonly transcriptListeners = new Set<(transcript: TranscriptState) => void>();
  private readonly transcriptStatusListeners = new Set<(status: TranscriptCapabilityStatus) => void>();
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
  onTranscriptStatus(listener: (status: TranscriptCapabilityStatus) => void) { this.transcriptStatusListeners.add(listener); return () => this.transcriptStatusListeners.delete(listener); }
  onFailure(listener: (failure: VoiceConnectionFailure) => void) { this.failureListeners.add(listener); return () => this.failureListeners.delete(listener); }
}
