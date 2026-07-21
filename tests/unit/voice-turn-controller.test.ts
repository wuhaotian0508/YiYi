import { describe, expect, it, vi } from "vitest";
import { VoiceTurnController } from "@/lib/realtime/voice-turn-controller";

describe("VoiceTurnController", () => {
  it("does not let background speech overwrite a protected product phase", () => {
    const states: string[] = [];
    const muted: boolean[] = [];
    const controller = new VoiceTurnController({
      publish: (state) => states.push(state),
      setMicrophoneMuted: (value) => muted.push(value),
    });

    controller.connected();
    controller.speechStopped();
    controller.toolStarted("request_outfit_recommendation");
    controller.speechStarted();

    expect(controller.state).toBe("tool_running");
    expect(states.filter((state) => state === "listening")).toHaveLength(1);
    expect(states.at(-1)).toBe("tool_running");
    expect(muted.at(-1)).toBe(true);
  });

  it("commits once and keeps the microphone muted until interrupted audio actually stops", () => {
    const commit = vi.fn();
    const interrupt = vi.fn();
    const muted: boolean[] = [];
    const controller = new VoiceTurnController({ publish: vi.fn(), setMicrophoneMuted: (value) => muted.push(value) });
    controller.connected();

    expect(controller.primaryAction({ commit, interrupt })).toBe("commit");
    expect(controller.primaryAction({ commit, interrupt })).toBe("none");
    expect(commit).toHaveBeenCalledOnce();
    expect(controller.state).toBe("committing");

    controller.audioStarted();
    expect(controller.primaryAction({ commit, interrupt })).toBe("interrupt");
    expect(interrupt).toHaveBeenCalledOnce();
    expect(controller.state).toBe("interrupted");
    expect(muted.at(-1)).toBe(true);

    controller.audioStopped();
    expect(controller.state).toBe("listening");
    expect(muted.at(-1)).toBe(false);
  });

  it("keeps error and listening mutually exclusive", () => {
    const states: string[] = [];
    const controller = new VoiceTurnController({ publish: (state) => states.push(state), setMicrophoneMuted: vi.fn() });
    controller.connected();
    controller.fail();
    controller.speechStarted();
    expect(controller.state).toBe("recoverable_error");
    expect(states.at(-1)).toBe("recoverable_error");
  });
});
