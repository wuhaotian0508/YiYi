import { VoiceConnectionFailure, type TranscriptCapabilityStatus, type TranscriptState, type VoiceFailureStage, type VoiceSessionAdapter, type VoiceState } from "@/lib/realtime/voice-session";
import { logVoiceDiagnostic, type VoiceDiagnostic } from "@/lib/realtime/voice-diagnostics";

export type VoiceOwner = "today" | "fine-tune";
export type VoiceStopReason = "user" | "background" | "timeout" | "route" | "cleanup";
export type VoiceLifecycleStatus = VoiceState | "rate_limited";

export type VoiceSessionSnapshot = {
  owner: VoiceOwner | null;
  status: VoiceLifecycleStatus;
  stage: VoiceFailureStage | null;
  generation: number;
  attemptId: string | null;
  retryAt: number | null;
  errorCode: string | null;
  diagnosticId: string | null;
  latestUserTranscript: TranscriptState | null;
  latestAssistantCaption: TranscriptState | null;
  transcriptStatus: TranscriptCapabilityStatus;
};

type ActiveSession = {
  owner: VoiceOwner;
  adapter: VoiceSessionAdapter;
  generation: number;
  unsubscribe: (() => void)[];
  startedAt: number;
  attemptId: string;
};

const initialSnapshot: VoiceSessionSnapshot = {
  owner: null,
  status: "idle",
  stage: null,
  generation: 0,
  attemptId: null,
  retryAt: null,
  errorCode: null,
  diagnosticId: null,
  latestUserTranscript: null,
  latestAssistantCaption: null,
  transcriptStatus: "pending",
};

export const voiceSessionServerSnapshot = () => initialSnapshot;

export class VoiceSessionCoordinator {
  private snapshot: VoiceSessionSnapshot = initialSnapshot;
  private active: ActiveSession | null = null;
  private connectPromise: Promise<void> | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly diagnostic: (diagnostic: VoiceDiagnostic) => void;

  constructor(options: { now?: () => number; diagnostic?: (diagnostic: VoiceDiagnostic) => void } = {}) {
    this.now = options.now ?? Date.now;
    this.diagnostic = options.diagnostic ?? (process.env.NODE_ENV === "test" ? () => undefined : logVoiceDiagnostic);
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(owner: VoiceOwner, createAdapter: (context: { attemptId: string; generation: number }) => VoiceSessionAdapter): Promise<void> {
    if (this.snapshot.status === "rate_limited" && this.snapshot.retryAt && this.now() < this.snapshot.retryAt) {
      return Promise.reject(new VoiceConnectionFailure({
        stage: "token",
        code: "RATE_LIMITED",
        httpStatus: 429,
        retryAfterMs: this.snapshot.retryAt - this.now(),
      }));
    }
    if (this.cleanupPromise) {
      return this.cleanupPromise.then(() => this.start(owner, createAdapter));
    }
    if (this.active) {
      if (this.active.owner !== owner) {
        return Promise.reject(new VoiceConnectionFailure({ stage: "lifecycle", code: "VOICE_SESSION_BUSY" }));
      }
      if (this.connectPromise) {
        this.record(this.active, "token", "reused", { tokenRequest: "reused" });
        return this.connectPromise;
      }
      this.record(this.active, "ready", "reused", { tokenRequest: "reused" });
      return Promise.resolve();
    }

    const generation = this.snapshot.generation + 1;
    const attemptId = crypto.randomUUID();
    const adapter = createAdapter({ attemptId, generation });
    const active: ActiveSession = { owner, adapter, generation, unsubscribe: [], startedAt: this.now(), attemptId };
    this.active = active;
    this.record(active, "token", "started", { tokenRequest: "new" });
    active.unsubscribe = [
      adapter.onState((status) => {
        if (!this.isActive(active)) return;
        this.publish({
          ...this.snapshot,
          owner,
          status,
          stage: status === "connecting" ? "token" : status === "recoverable_error" ? this.snapshot.stage ?? "lifecycle" : null,
          generation,
          attemptId,
          retryAt: null,
          errorCode: status === "recoverable_error" ? this.snapshot.errorCode ?? "VOICE_RUNTIME_FAILED" : null,
        });
        if (status === "listening") this.record(active, "ready", "success", { sdkConnectionStatus: "connected" });
        if (status === "recoverable_error" && !this.connectPromise) void this.closeRuntimeFailure(active);
      }),
      adapter.onTranscript((transcript) => {
        if (!this.isActive(active)) return;
        this.publish(transcript.role === "user"
          ? { ...this.snapshot, latestUserTranscript: transcript }
          : { ...this.snapshot, latestAssistantCaption: transcript });
      }),
      ...(adapter.onTranscriptStatus ? [adapter.onTranscriptStatus((transcriptStatus) => {
        if (!this.isActive(active)) return;
        this.publish({ ...this.snapshot, transcriptStatus });
      })] : []),
      adapter.onFailure((failure) => {
        if (!this.isActive(active)) return;
        this.publish({ ...this.snapshot, status: "recoverable_error", stage: failure.stage, errorCode: failure.code, diagnosticId: failure.requestId ?? attemptId });
        this.record(active, failure.stage, "error", { errorCode: failure.code, errorType: failure.errorType, zodIssuePaths: failure.zodIssuePaths, httpStatus: failure.httpStatus, sdkConnectionStatus: "disconnected" });
        void this.closeRuntimeFailure(active);
      }),
    ];
    this.publish({ owner, status: "connecting", stage: "token", generation, attemptId, retryAt: null, errorCode: null, diagnosticId: null, latestUserTranscript: null, latestAssistantCaption: null, transcriptStatus: "pending" });

    const promise = adapter.connect().then(
      () => {
        if (!this.isActive(active)) return;
        if (this.snapshot.status === "connecting") this.publish({ ...this.snapshot, status: "listening", stage: null });
      },
      async (error: unknown) => {
        if (!this.isActive(active)) return;
        active.unsubscribe.forEach((unsubscribe) => unsubscribe());
        active.unsubscribe = [];
        this.active = null;
        await this.beginCleanup(active, "cleanup");
        const failure = error instanceof VoiceConnectionFailure
          ? error
          : new VoiceConnectionFailure({ stage: "webrtc", code: "VOICE_CONNECT_FAILED" });
        const retryAt = failure.httpStatus === 429 && failure.retryAfterMs
          ? this.now() + failure.retryAfterMs
          : null;
        this.publish({
          ...this.snapshot,
          owner,
          status: retryAt ? "rate_limited" : "recoverable_error",
          stage: failure.stage,
          retryAt,
          errorCode: failure.code,
          diagnosticId: failure.requestId ?? attemptId,
        });
        this.record(active, failure.stage, "error", { errorCode: failure.code, errorType: failure.errorType, zodIssuePaths: failure.zodIssuePaths, httpStatus: failure.httpStatus, sdkConnectionStatus: "disconnected" });
        throw failure;
      },
    );
    this.connectPromise = promise;
    void promise.then(
      () => { if (this.connectPromise === promise) this.connectPromise = null; },
      () => { if (this.connectPromise === promise) this.connectPromise = null; },
    );
    return promise;
  }

  async stop(owner: VoiceOwner, _reason: VoiceStopReason) {
    const active = this.active;
    if (!active || active.owner !== owner) return;
    active.unsubscribe.forEach((unsubscribe) => unsubscribe());
    active.unsubscribe = [];
    this.active = null;
    this.connectPromise = null;
    this.publish({ ...initialSnapshot, generation: this.snapshot.generation + 1 });
    await this.beginCleanup(active, _reason);
  }

  mute(owner: VoiceOwner, muted: boolean) {
    if (this.active?.owner === owner) this.active.adapter.mute(muted);
  }

  pauseForBackground(owner: VoiceOwner) {
    const active = this.active;
    if (!active || active.owner !== owner) return false;
    active.adapter.mute(true);
    this.record(active, "lifecycle", "started", { disconnectReason: "background" });
    return true;
  }

  resumeFromBackground(owner: VoiceOwner) {
    const active = this.active;
    if (!active || active.owner !== owner) return false;
    // Resuming the page must not reopen the microphone over an assistant
    // response or application mutation. The turn controller will unmute when
    // the lifecycle returns to listening.
    active.adapter.mute(this.snapshot.status !== "listening");
    this.record(active, "lifecycle", "success", { disconnectReason: "background-resume" });
    return true;
  }

  commitTurn(owner: VoiceOwner) {
    if (this.active?.owner !== owner || this.snapshot.status !== "listening") return false;
    this.active.adapter.commitTurn?.();
    return true;
  }

  interruptAndListen(owner: VoiceOwner) {
    if (this.active?.owner !== owner || this.snapshot.status !== "speaking") return false;
    this.active.adapter.interruptAndListen?.();
    return true;
  }

  submitDemoTurn(owner: VoiceOwner) {
    if (this.active?.owner === owner) this.active.adapter.submitDemoTurn?.();
  }

  isCurrent(owner: VoiceOwner, generation: number) {
    return this.active?.owner === owner && this.active.generation === generation;
  }

  private isActive(active: ActiveSession) {
    return this.active === active && this.snapshot.generation === active.generation;
  }

  private async closeRuntimeFailure(active: ActiveSession) {
    if (!this.isActive(active)) return;
    active.unsubscribe.forEach((unsubscribe) => unsubscribe());
    active.unsubscribe = [];
    this.active = null;
    await this.beginCleanup(active, "cleanup");
  }

  private beginCleanup(active: ActiveSession, reason: VoiceStopReason) {
    const cleanup = (async () => {
      try {
        await active.adapter.disconnect();
        this.record(active, "cleanup", "success", { disconnectReason: reason, sdkConnectionStatus: "disconnected" });
      } catch {
        this.record(active, "cleanup", "error", { disconnectReason: reason, errorCode: "VOICE_CLEANUP_FAILED" });
      }
    })();
    this.cleanupPromise = cleanup;
    void cleanup.finally(() => {
      if (this.cleanupPromise === cleanup) this.cleanupPromise = null;
    });
    return cleanup;
  }

  private publish(snapshot: VoiceSessionSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  private record(active: ActiveSession, stage: VoiceFailureStage, result: VoiceDiagnostic["result"], extra: Partial<VoiceDiagnostic> = {}) {
    this.diagnostic({
      voiceAttemptId: active.attemptId,
      sessionGeneration: active.generation,
      owner: active.owner,
      stage,
      result,
      durationMs: this.now() - active.startedAt,
      retryCount: 0,
      ...extra,
    });
  }
}

export const voiceSessionCoordinator = new VoiceSessionCoordinator();
