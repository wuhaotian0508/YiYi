import { PreferenceDeltaSchema, type PreferenceDelta } from "@/domain/schemas";
import { VoiceConnectionFailure, type TranscriptState, type VoiceSessionAdapter, type VoiceState } from "@/lib/realtime/voice-session";

type MockPreferenceFixture = {
  matches: (normalized: string) => boolean;
  delta: Omit<PreferenceDelta, "action" | "signalId" | "strength" | "scope" | "categories" | "slots" | "combinationValues" | "confidence" | "needsReview" | "evidenceSummary"> & Partial<Pick<PreferenceDelta, "strength" | "scope" | "categories" | "slots" | "combinationValues">>;
};

const mockPreferenceFixtures: MockPreferenceFixture[] = [
  {
    matches: (value) => value.includes("soft texture"),
    delta: { attribute: "style", value: "soft", label: "Soft textures", polarity: "more" },
  },
  {
    matches: (value) => value.includes("less formal") || value.includes("avoid formal"),
    delta: { attribute: "formality", value: "formal", label: "Formal looks", polarity: "less" },
  },
  {
    matches: (value) => value.includes("silver") && (value.includes("jewelry") || value.includes("jewellery")),
    delta: { attribute: "metal", value: "silver", label: "Silver jewelry", polarity: "more", scope: "category", categories: ["jewelry"], slots: ["jewelry"] },
  },
  {
    matches: (value) => value.includes("black") && value.includes("white") && value.includes("together") && (value.includes("avoid") || value.includes("don't like") || value.includes("do not like")),
    delta: { attribute: "combination", value: "black-and-white", label: "Black and white together", polarity: "less", combinationValues: ["black", "white"] },
  },
];

/**
 * Development/mock-only interpreter. It deliberately recognizes a tiny fixed
 * fixture vocabulary; production language understanding belongs to Realtime.
 */
export function interpretMockPreferenceTranscript(transcript: string): PreferenceDelta[] {
  const normalized = transcript.trim().toLowerCase();
  const matched = mockPreferenceFixtures.filter((fixture) => fixture.matches(normalized));
  if (!matched.length) {
    throw new VoiceConnectionFailure({ stage: "tool", code: "PREFERENCE_NOT_UNDERSTOOD" });
  }
  return matched.map(({ delta }) => PreferenceDeltaSchema.parse({
    action: "add",
    signalId: null,
    strength: delta.strength ?? "soft",
    scope: delta.scope ?? "global_style",
    categories: delta.categories ?? [],
    slots: delta.slots ?? [],
    combinationValues: delta.combinationValues ?? [],
    confidence: 0.98,
    needsReview: false,
    evidenceSummary: normalized.slice(0, 160),
    ...delta,
  }));
}

type SpeechResultEvent = { results: ArrayLike<{ 0: { transcript: string } }> };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionWindow = Window & typeof globalThis & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

export class BrowserPreferenceVoiceAdapter implements VoiceSessionAdapter {
  private recognition: SpeechRecognitionLike | null = null;
  private connectPromise: Promise<void> | null = null;
  private intentionalStop = false;
  private receivedFinalResult = false;
  private readonly stateListeners = new Set<(state: VoiceState) => void>();
  private readonly transcriptListeners = new Set<(transcript: TranscriptState) => void>();
  private readonly failureListeners = new Set<(failure: VoiceConnectionFailure) => void>();

  connect() {
    if (this.connectPromise) return this.connectPromise;
    const promise = this.connectOnce();
    this.connectPromise = promise;
    void promise.then(
      () => { if (this.connectPromise === promise) this.connectPromise = null; },
      () => { if (this.connectPromise === promise) this.connectPromise = null; },
    );
    return promise;
  }

  private async connectOnce() {
    this.intentionalStop = false;
    this.receivedFinalResult = false;
    this.emitState("connecting");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { throw new VoiceConnectionFailure({ stage: "permission", code: "MICROPHONE_UNAVAILABLE" }); }
    stream.getTracks().forEach((track) => track.stop());
    const speechWindow = window as SpeechRecognitionWindow;
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) throw new VoiceConnectionFailure({ stage: "session", code: "SPEECH_RECOGNITION_UNAVAILABLE" });
    const recognition = new Constructor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = event.results[event.results.length - 1]?.[0]?.transcript?.trim() ?? "";
      if (!text) { this.emitFailure(new VoiceConnectionFailure({ stage: "session", code: "EMPTY_TRANSCRIPT" })); this.emitState("recoverable_error"); return; }
      this.receivedFinalResult = true;
      this.emitTranscript({ role: "user", text, final: true });
      this.emitState("understanding");
    };
    recognition.onerror = () => { this.emitFailure(new VoiceConnectionFailure({ stage: "permission", code: "SPEECH_RECOGNITION_FAILED" })); this.emitState("recoverable_error"); };
    recognition.onend = () => {
      if (this.receivedFinalResult) return;
      const code = this.intentionalStop ? "EMPTY_TRANSCRIPT" : "SPEECH_RECOGNITION_ENDED";
      this.emitFailure(new VoiceConnectionFailure({ stage: "session", code }));
      this.emitState("recoverable_error");
    };
    this.recognition = recognition;
    try { recognition.start(); }
    catch { this.recognition = null; throw new VoiceConnectionFailure({ stage: "permission", code: "MICROPHONE_START_FAILED" }); }
    this.emitState("listening");
  }

  async disconnect() {
    this.intentionalStop = true;
    this.connectPromise = null;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.stop(); } catch { /* It may already have ended. */ }
    }
    this.emitState("idle");
  }

  mute() {}
  commitTurn() {
    if (!this.recognition || this.receivedFinalResult) return;
    this.intentionalStop = true;
    this.emitState("committing");
    try { this.recognition.stop(); }
    catch {
      this.emitFailure(new VoiceConnectionFailure({ stage: "session", code: "TURN_COMMIT_FAILED" }));
      this.emitState("recoverable_error");
    }
  }
  onState(listener: (state: VoiceState) => void) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcriptListeners.add(listener); return () => this.transcriptListeners.delete(listener); }
  onFailure(listener: (failure: VoiceConnectionFailure) => void) { this.failureListeners.add(listener); return () => this.failureListeners.delete(listener); }
  private emitState(state: VoiceState) { this.stateListeners.forEach((listener) => listener(state)); }
  private emitTranscript(transcript: TranscriptState) { this.transcriptListeners.forEach((listener) => listener(transcript)); }
  private emitFailure(failure: VoiceConnectionFailure) { this.failureListeners.forEach((listener) => listener(failure)); }
}
