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

  it("commits a listening turn once and interrupts speaking back to listening", () => {
    const commit = vi.fn();
    const interrupt = vi.fn();
    const controller = new VoiceTurnController({ publish: vi.fn(), setMicrophoneMuted: vi.fn() });
    controller.connected();

    expect(controller.primaryAction({ commit, interrupt })).toBe("commit");
    expect(controller.primaryAction({ commit, interrupt })).toBe("none");
    expect(commit).toHaveBeenCalledOnce();
    expect(controller.state).toBe("committing");

    controller.audioStarted();
    expect(controller.primaryAction({ commit, interrupt })).toBe("interrupt");
    expect(interrupt).toHaveBeenCalledOnce();
    expect(controller.state).toBe("listening");
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
