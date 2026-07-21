import { afterEach, describe, expect, it, vi } from "vitest";
import { startVoiceAudioEnergySampler, voiceInputEnergy, voiceOutputEnergy } from "@/lib/realtime/audio-energy";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  voiceInputEnergy.set(0);
  voiceOutputEnergy.set(0);
});

describe("Safari voice audio energy", () => {
  it("uses the local microphone track when WebRTC stats omit audioLevel", async () => {
    vi.useFakeTimers();
    const close = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      getByteTimeDomainData: (samples: Uint8Array) => samples.fill(160),
      disconnect,
    };
    vi.stubGlobal("MediaStream", class MediaStreamMock { constructor(readonly tracks: MediaStreamTrack[]) {} });
    vi.stubGlobal("AudioContext", class AudioContextMock {
      state = "running";
      createMediaStreamSource() { return { connect: vi.fn(), disconnect }; }
      createAnalyser() { return analyser; }
      resume = vi.fn().mockResolvedValue(undefined);
      close = close;
    });
    const peerConnection = {
      getSenders: () => [{ track: { kind: "audio" } }],
      getStats: vi.fn().mockResolvedValue(new Map()),
    } as unknown as RTCPeerConnection;

    const stop = startVoiceAudioEnergySampler(peerConnection, 20);
    await vi.advanceTimersByTimeAsync(25);

    expect(voiceInputEnergy.get()).toBeGreaterThan(0);
    expect(voiceOutputEnergy.get()).toBe(0);
    stop();
    expect(voiceInputEnergy.get()).toBe(0);
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps zero energy without throwing when neither stats nor an analyser are available", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("AudioContext", undefined);
    const peerConnection = {
      getSenders: () => [],
      getStats: vi.fn().mockRejectedValue(new Error("audioLevel unavailable")),
    } as unknown as RTCPeerConnection;

    const stop = startVoiceAudioEnergySampler(peerConnection, 20);
    await vi.advanceTimersByTimeAsync(25);
    expect(voiceInputEnergy.get()).toBe(0);
    expect(voiceOutputEnergy.get()).toBe(0);
    stop();
  });
});
