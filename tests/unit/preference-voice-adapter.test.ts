import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserPreferenceVoiceAdapter, interpretMockPreferenceTranscript } from "@/lib/realtime/preference-voice-adapter";

class FakeRecognition {
  static latest: FakeRecognition | null = null;
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  constructor() { FakeRecognition.latest = this; }
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "SpeechRecognition");
  FakeRecognition.latest = null;
});

describe("BrowserPreferenceVoiceAdapter", () => {
  it("shares a pending permission request and stops every owned resource", async () => {
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    const states: string[] = [];
    const adapter = new BrowserPreferenceVoiceAdapter();
    adapter.onState((state) => states.push(state));

    const first = adapter.connect();
    const second = adapter.connect();
    await Promise.all([first, second]);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeRecognition.latest?.start).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["connecting", "listening"]);

    await adapter.disconnect();
    expect(FakeRecognition.latest?.stop).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("idle");
  });

  it("classifies denied microphone permission without retrying", async () => {
    const getUserMedia = vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const adapter = new BrowserPreferenceVoiceAdapter();

    await expect(adapter.connect()).rejects.toMatchObject({ stage: "permission", code: "MICROPHONE_UNAVAILABLE" });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("does not turn the normal end after a final mock transcript into an error", async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    const states: string[] = [];
    const failures: string[] = [];
    const adapter = new BrowserPreferenceVoiceAdapter();
    adapter.onState((state) => states.push(state));
    adapter.onFailure((failure) => failures.push(failure.code));
    await adapter.connect();

    FakeRecognition.latest?.onresult?.({ results: [{ 0: { transcript: "I usually prefer silver jewelry" } }] });
    FakeRecognition.latest?.onend?.();

    expect(states.at(-1)).toBe("thinking");
    expect(failures).toEqual([]);
  });

  it("turns a controlled mock utterance into validated structured deltas instead of saving raw transcript", () => {
    expect(interpretMockPreferenceTranscript("More soft textures and less formal structure")).toEqual([
      expect.objectContaining({
        action: "add",
        attribute: "style",
        value: "soft",
        label: "Soft textures",
        polarity: "more",
        needsReview: false,
      }),
      expect.objectContaining({
        action: "add",
        attribute: "formality",
        value: "formal",
        label: "Formal looks",
        polarity: "less",
        needsReview: false,
      }),
    ]);
  });

  it("keeps combination semantics intact and rejects unsupported mock language", () => {
    expect(interpretMockPreferenceTranscript("I usually avoid black and white together")).toEqual([
      expect.objectContaining({
        attribute: "combination",
        polarity: "less",
        combinationValues: ["black", "white"],
      }),
    ]);
    expect(() => interpretMockPreferenceTranscript("Maybe surprise me somehow")).toThrowError(expect.objectContaining({
      stage: "tool",
      code: "PREFERENCE_NOT_UNDERSTOOD",
    }));
  });
});
