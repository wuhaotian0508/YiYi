import { describe, expect, it, vi } from "vitest";
import { classifyRealtimeSessionFailure, VoiceConnectionFailure, type TranscriptCapabilityStatus, type TranscriptState, type VoiceSessionAdapter, type VoiceState } from "@/lib/realtime/voice-session";
import { VoiceSessionCoordinator } from "@/lib/realtime/voice-session-coordinator";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeVoiceAdapter implements VoiceSessionAdapter {
  readonly states = new Set<(state: VoiceState) => void>();
  readonly transcripts = new Set<(transcript: TranscriptState) => void>();
  readonly transcriptStatuses = new Set<(status: TranscriptCapabilityStatus) => void>();
  readonly failures = new Set<(failure: VoiceConnectionFailure) => void>();
  connectCalls = 0;
  disconnectCalls = 0;
  commitCalls = 0;
  interruptCalls = 0;
  muted = false;

  constructor(
    private readonly connection: Promise<void> = Promise.resolve(),
    private readonly cleanup: Promise<void> = Promise.resolve(),
  ) {}

  connect() { this.connectCalls += 1; this.emit("connecting"); return this.connection; }
  async disconnect() { this.disconnectCalls += 1; this.emit("idle"); await this.cleanup; }
  mute(muted: boolean) { this.muted = muted; }
  commitTurn() { this.commitCalls += 1; this.emit("committing"); }
  interruptAndListen() { this.interruptCalls += 1; this.emit("listening"); }
  onState(listener: (state: VoiceState) => void) { this.states.add(listener); return () => this.states.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcripts.add(listener); return () => this.transcripts.delete(listener); }
  onTranscriptStatus(listener: (status: TranscriptCapabilityStatus) => void) { this.transcriptStatuses.add(listener); return () => this.transcriptStatuses.delete(listener); }
  onFailure(listener: (failure: VoiceConnectionFailure) => void) { this.failures.add(listener); return () => this.failures.delete(listener); }
  emit(state: VoiceState) { this.states.forEach((listener) => listener(state)); }
  fail(failure: VoiceConnectionFailure) { this.failures.forEach((listener) => listener(failure)); this.emit("recoverable_error"); }
  failWithoutState(failure: VoiceConnectionFailure) { this.failures.forEach((listener) => listener(failure)); }
  emitTranscript(transcript: TranscriptState) { this.transcripts.forEach((listener) => listener(transcript)); }
  emitTranscriptStatus(status: TranscriptCapabilityStatus) { this.transcriptStatuses.forEach((listener) => listener(status)); }
}

describe("VoiceSessionCoordinator", () => {
  it("preserves safe nested Realtime provider errors while a session is becoming ready", () => {
    const failure = classifyRealtimeSessionFailure({
      type: "error",
      error: {
        type: "error",
        error: { type: "invalid_request_error", code: "invalid_value", message: "session-specific details stay private" },
      },
    }, false, "connecting");

    expect(failure).toMatchObject({ stage: "ready", code: "invalid_value", errorType: "invalid_request_error" });
    expect(failure.message).not.toContain("session-specific details");
  });

  it("routes central commit and interrupt actions only in their valid states", async () => {
    const adapter = new FakeVoiceAdapter();
    const coordinator = new VoiceSessionCoordinator();
    await coordinator.start("today", () => adapter);
    adapter.emit("listening");
    expect(coordinator.commitTurn("today")).toBe(true);
    expect(coordinator.commitTurn("today")).toBe(false);
    expect(adapter.commitCalls).toBe(1);
    adapter.emit("speaking");
    expect(coordinator.interruptAndListen("today")).toBe(true);
    expect(coordinator.interruptAndListen("today")).toBe(false);
    expect(adapter.interruptCalls).toBe(1);
  });

  it("shares one connect promise across simultaneous callers for the same owner", async () => {
    const pending = deferred<void>();
    const adapter = new FakeVoiceAdapter(pending.promise);
    const factory = vi.fn(() => adapter);
    const coordinator = new VoiceSessionCoordinator();

    const first = coordinator.start("today", factory);
    const second = coordinator.start("today", factory);

    expect(second).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(adapter.connectCalls).toBe(1);
    pending.resolve();
    await first;
    adapter.emit("listening");
    expect(coordinator.getSnapshot().status).toBe("listening");
  });

  it("keeps Today and Fine-tune from owning the microphone simultaneously", async () => {
    const pending = deferred<void>();
    const today = new FakeVoiceAdapter(pending.promise);
    const fineTune = new FakeVoiceAdapter();
    const coordinator = new VoiceSessionCoordinator();
    void coordinator.start("today", () => today);

    await expect(coordinator.start("fine-tune", () => fineTune)).rejects.toMatchObject({ code: "VOICE_SESSION_BUSY" });
    expect(fineTune.connectCalls).toBe(0);
    pending.resolve();
  });

  it("does not automatically retry a failed connect", async () => {
    vi.useFakeTimers();
    const adapter = new FakeVoiceAdapter(Promise.reject(new VoiceConnectionFailure({ stage: "webrtc", code: "WEBRTC_CONNECT_FAILED" })));
    const factory = vi.fn(() => adapter);
    const coordinator = new VoiceSessionCoordinator();

    await expect(coordinator.start("today", factory)).rejects.toMatchObject({ code: "WEBRTC_CONNECT_FAILED" });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot().status).toBe("recoverable_error");
    vi.useRealTimers();
  });

  it("honors a 429 cooldown until an explicit retry after Retry-After", async () => {
    let now = 1_000;
    const limited = new FakeVoiceAdapter(Promise.reject(new VoiceConnectionFailure({ stage: "token", code: "RATE_LIMITED", httpStatus: 429, retryAfterMs: 10_000 })));
    const recovered = new FakeVoiceAdapter();
    const factory = vi.fn().mockReturnValueOnce(limited).mockReturnValueOnce(recovered);
    const coordinator = new VoiceSessionCoordinator({ now: () => now });

    await expect(coordinator.start("today", factory)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(coordinator.getSnapshot()).toMatchObject({ status: "rate_limited", retryAt: 11_000 });
    await expect(coordinator.start("today", factory)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(factory).toHaveBeenCalledTimes(1);

    now = 11_001;
    await coordinator.start("today", factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("rejects stale events from a previous session generation", async () => {
    const first = new FakeVoiceAdapter();
    const second = new FakeVoiceAdapter();
    const coordinator = new VoiceSessionCoordinator();
    await coordinator.start("today", () => first);
    await coordinator.stop("today", "user");
    await coordinator.start("today", () => second);
    second.emit("listening");
    first.emit("recoverable_error");

    expect(coordinator.getSnapshot().status).toBe("listening");
    expect(first.states.size).toBe(0);
  });

  it("can disconnect before connect settles without publishing stale ready state", async () => {
    const pending = deferred<void>();
    const adapter = new FakeVoiceAdapter(pending.promise);
    const coordinator = new VoiceSessionCoordinator();
    const connecting = coordinator.start("today", () => adapter);

    await coordinator.stop("today", "user");
    pending.resolve();
    await connecting;

    expect(adapter.disconnectCalls).toBe(1);
    expect(coordinator.getSnapshot()).toMatchObject({ owner: null, status: "idle" });
  });

  it("does not start a replacement session until the previous adapter has finished cleanup", async () => {
    const cleanup = deferred<void>();
    const first = new FakeVoiceAdapter(Promise.resolve(), cleanup.promise);
    const second = new FakeVoiceAdapter();
    const coordinator = new VoiceSessionCoordinator();
    await coordinator.start("today", () => first);

    const stopping = coordinator.stop("today", "route");
    const restarting = coordinator.start("fine-tune", () => second);
    await Promise.resolve();

    expect(first.disconnectCalls).toBe(1);
    expect(second.connectCalls).toBe(0);
    cleanup.resolve();
    await stopping;
    await restarting;
    expect(second.connectCalls).toBe(1);
  });

  it("reuses a healthy multi-turn session and cleans listeners on close", async () => {
    const adapter = new FakeVoiceAdapter();
    const factory = vi.fn(() => adapter);
    const coordinator = new VoiceSessionCoordinator();
    await coordinator.start("today", factory);
    adapter.emit("listening");
    await coordinator.start("today", factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(adapter.connectCalls).toBe(1);
    expect(adapter.states.size).toBe(1);

    await coordinator.stop("today", "user");
    expect(adapter.disconnectCalls).toBe(1);
    expect(adapter.states.size).toBe(0);
    expect(adapter.transcripts.size).toBe(0);
    expect(adapter.failures.size).toBe(0);
  });

  it("releases a runtime-failed adapter before allowing an explicit retry", async () => {
    const failed = new FakeVoiceAdapter();
    const recovered = new FakeVoiceAdapter();
    const coordinator = new VoiceSessionCoordinator();
    await coordinator.start("today", () => failed);
    failed.emit("listening");

    failed.fail(new VoiceConnectionFailure({ stage: "audio", code: "AUDIO_OUTPUT_FAILED" }));
    await vi.waitFor(() => expect(failed.disconnectCalls).toBe(1));
    expect(coordinator.getSnapshot()).toMatchObject({ status: "recoverable_error", stage: "audio", errorCode: "AUDIO_OUTPUT_FAILED" });

    await coordinator.start("today", () => recovered);
    expect(recovered.connectCalls).toBe(1);
  });

  it("releases an adapter when a runtime failure arrives without a matching state event", async () => {
    const failed = new FakeVoiceAdapter();
    const recovered = new FakeVoiceAdapter();
    const coordinator = new VoiceSessionCoordinator();
    await coordinator.start("today", () => failed);
    failed.emit("listening");

    failed.failWithoutState(new VoiceConnectionFailure({ stage: "audio", code: "AUDIO_OUTPUT_FAILED" }));
    await vi.waitFor(() => expect(failed.disconnectCalls).toBe(1));
    expect(coordinator.getSnapshot()).toMatchObject({ status: "recoverable_error", stage: "audio", errorCode: "AUDIO_OUTPUT_FAILED" });

    await coordinator.start("today", () => recovered);
    expect(recovered.connectCalls).toBe(1);
  });

  it("keeps the latest user transcript separate from the assistant caption", async () => {
    const adapter = new FakeVoiceAdapter();
    const coordinator = new VoiceSessionCoordinator();
    await coordinator.start("today", () => adapter);

    adapter.emitTranscript({ role: "user", text: "Hiking and dinner.", final: true });
    adapter.emitTranscript({ role: "assistant", text: "I found one.", final: true });

    expect(coordinator.getSnapshot()).toMatchObject({
      latestUserTranscript: { role: "user", text: "Hiking and dinner.", final: true },
      latestAssistantCaption: { role: "assistant", text: "I found one.", final: true },
    });
  });

  it("tracks transcript readiness without changing the Voice lifecycle state", async () => {
    const adapter = new FakeVoiceAdapter();
    const coordinator = new VoiceSessionCoordinator();
    await coordinator.start("today", () => adapter);
    adapter.emit("listening");
    adapter.emitTranscriptStatus("failed");

    expect(coordinator.getSnapshot()).toMatchObject({ status: "listening", transcriptStatus: "failed" });
  });
});
