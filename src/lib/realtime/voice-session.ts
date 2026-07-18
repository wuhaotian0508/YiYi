import { z } from "zod";
import { RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import { DailyIntentSchema } from "@/domain/schemas";
import { clothingCategories } from "@/domain/taxonomy";
import { realtimeAgentInstructions } from "@/prompts/realtime-agent";

export type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "interrupted" | "error";
export type TranscriptState = { role: "user" | "assistant"; text: string; final: boolean };

export interface VoiceSessionAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  mute(muted: boolean): void;
  onState(listener: (state: VoiceState) => void): () => void;
  onTranscript(listener: (transcript: TranscriptState) => void): () => void;
}

export type VoiceToolHandlers = {
  requestRecommendation(intent: z.infer<typeof DailyIntentSchema>): Promise<{ success: boolean; summary: string }>;
  revise(input: { target: string; revision: string; preserveUnmentionedItems: boolean; referencedItemId: string | null; action: "revise" | "undo" }): Promise<{ success: boolean; summary: string }>;
  confirm(note: string | null): Promise<{ success: boolean; summary: string }>;
  setAvailability(input: { itemId: string | null; availability: "available" | "laundry" | "unavailable"; reason: string | null }): Promise<{ success: boolean; summary: string }>;
  savePreference(input: { rule: string; polarity: "prefer" | "avoid"; evidencePhrase: string }): Promise<{ success: boolean; summary: string }>;
};

export function resolveAvailabilityItemId(explicitItemId: string | null, focusedItemId: string | null) {
  return explicitItemId ?? focusedItemId;
}

const revisionSchema = z.object({
  target: z.enum([...clothingCategories, "overall"]),
  revision: z.string().min(1).max(300),
  preserveUnmentionedItems: z.boolean(),
  referencedItemId: z.string().uuid().nullable(),
  action: z.enum(["revise", "undo"]),
}).strict();

function toolsFor(handlers: VoiceToolHandlers) {
  return [
    tool({ name: "request_outfit_recommendation", description: "Create one main outfit and two alternatives from a complete daily intent.", parameters: DailyIntentSchema, strict: true, timeoutMs: 25_000, execute: (input) => handlers.requestRecommendation(input) }),
    tool({ name: "revise_current_outfit", description: "Revise only the requested outfit target, or undo the last version.", parameters: revisionSchema, strict: true, timeoutMs: 20_000, execute: (input) => handlers.revise(input) }),
    tool({ name: "confirm_current_outfit", description: "Confirm and persist the current outfit before telling the user it is decided.", parameters: z.object({ note: z.string().max(160).nullable() }).strict(), strict: true, timeoutMs: 8_000, execute: ({ note }) => handlers.confirm(note) }),
    tool({ name: "set_item_availability", description: "Mark an explicit item ID or the currently focused wardrobe item available, in laundry, or unavailable. Pass null when no item ID is known.", parameters: z.object({ itemId: z.string().uuid().nullable(), availability: z.enum(["available", "laundry", "unavailable"]), reason: z.string().max(120).nullable() }).strict(), strict: true, timeoutMs: 8_000, execute: (input) => handlers.setAvailability(input) }),
    tool({ name: "save_explicit_preference", description: "Save only an explicit or repeated long-term preference.", parameters: z.object({ rule: z.string().min(1).max(120), polarity: z.enum(["prefer", "avoid"]), evidencePhrase: z.string().min(1).max(200) }).strict(), strict: true, timeoutMs: 8_000, execute: (input) => handlers.savePreference(input) }),
  ];
}

export class OpenAIRealtimeVoiceAdapter implements VoiceSessionAdapter {
  private session: RealtimeSession | null = null;
  private readonly stateListeners = new Set<(state: VoiceState) => void>();
  private readonly transcriptListeners = new Set<(transcript: TranscriptState) => void>();

  constructor(private readonly handlers: VoiceToolHandlers) {}

  async connect() {
    this.emitState("connecting");
    const response = await fetch("/api/realtime/token", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store" });
    if (!response.ok) { this.emitState("error"); throw new Error("Realtime token unavailable"); }
    const payload: unknown = await response.json();
    const token = z.object({ value: z.string().min(1), model: z.string().min(1), voice: z.string().min(1) }).parse(payload);
    const agent = new RealtimeAgent({ name: "YiYi", voice: token.voice, instructions: realtimeAgentInstructions, tools: toolsFor(this.handlers) });
    const session = new RealtimeSession(agent, { model: token.model, transport: "webrtc", tracingDisabled: true, historyStoreAudio: false });
    session.on("audio_start", () => this.emitState("speaking"));
    session.on("audio_stopped", () => this.emitState("listening"));
    session.on("audio_interrupted", () => this.emitState("interrupted"));
    session.on("agent_start", () => this.emitState("thinking"));
    session.on("error", () => this.emitState("error"));
    session.on("history_updated", (history) => {
      const latest = [...history].reverse().find((item) => item.type === "message" && (item.role === "user" || item.role === "assistant"));
      if (!latest || latest.type !== "message" || (latest.role !== "user" && latest.role !== "assistant")) return;
      const text = latest.content.map((content) => "text" in content ? content.text : content.transcript ?? "").join(" ").trim();
      if (text) this.emitTranscript({ role: latest.role, text, final: latest.status === "completed" });
    });
    await session.connect({ apiKey: token.value });
    this.session = session;
    this.emitState("listening");
  }

  async disconnect() { this.session?.close(); this.session = null; this.emitState("idle"); }
  mute(muted: boolean) { this.session?.mute(muted); }
  onState(listener: (state: VoiceState) => void) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcriptListeners.add(listener); return () => this.transcriptListeners.delete(listener); }
  private emitState(state: VoiceState) { this.stateListeners.forEach((listener) => listener(state)); }
  private emitTranscript(transcript: TranscriptState) { this.transcriptListeners.forEach((listener) => listener(transcript)); }
}

export class MockVoiceSessionAdapter implements VoiceSessionAdapter {
  private readonly stateListeners = new Set<(state: VoiceState) => void>();
  private readonly transcriptListeners = new Set<(transcript: TranscriptState) => void>();
  private timers: number[] = [];
  async connect() {
    this.stateListeners.forEach((listener) => listener("connecting"));
    this.timers.push(window.setTimeout(() => this.stateListeners.forEach((listener) => listener("listening")), 300));
    this.timers.push(window.setTimeout(() => this.transcriptListeners.forEach((listener) => listener({ role: "user", text: "Gallery this afternoon, dinner tonight, lots of walking, and no dresses.", final: true })), 1000));
  }
  async disconnect() { this.timers.forEach(window.clearTimeout); this.timers = []; this.stateListeners.forEach((listener) => listener("idle")); }
  mute() {}
  onState(listener: (state: VoiceState) => void) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onTranscript(listener: (transcript: TranscriptState) => void) { this.transcriptListeners.add(listener); return () => this.transcriptListeners.delete(listener); }
}
