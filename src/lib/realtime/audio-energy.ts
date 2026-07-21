import { motionValue } from "motion";

// Shared MotionValues keep audio-reactive rendering outside React state. The
// adapter updates them from WebRTC stats and all consumers observe the same
// active session without per-frame component renders.
export const voiceInputEnergy = motionValue(0);
export const voiceOutputEnergy = motionValue(0);

export function resetVoiceAudioEnergy() {
  voiceInputEnergy.set(0);
  voiceOutputEnergy.set(0);
}

type AudioLevelStat = RTCStats & { audioLevel?: number; kind?: string; mediaType?: string };

type InputAnalyser = {
  read(): number;
  close(): void;
};

function createInputAnalyser(peerConnection: RTCPeerConnection): InputAnalyser | null {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function" || typeof MediaStream !== "function") return null;
  const track = peerConnection.getSenders?.().find((sender) => sender.track?.kind === "audio")?.track;
  if (!track) return null;
  let context: AudioContext | null = null;
  try {
    context = new window.AudioContext();
    const activeContext = context;
    const source = activeContext.createMediaStreamSource(new MediaStream([track]));
    const analyser = activeContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.68;
    const samples = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    if (activeContext.state === "suspended") void activeContext.resume().catch(() => undefined);
    return {
      read() {
        analyser.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sumSquares += normalized * normalized;
        }
        return Math.min(1, Math.sqrt(sumSquares / samples.length) * 4);
      },
      close() {
        source.disconnect();
        analyser.disconnect();
        void activeContext.close().catch(() => undefined);
      },
    };
  } catch {
    if (context) void context.close().catch(() => undefined);
    return null;
  }
}

export function startVoiceAudioEnergySampler(peerConnection: RTCPeerConnection, intervalMs = 80) {
  let stopped = false;
  let sampling = false;
  const inputAnalyser = createInputAnalyser(peerConnection);
  const sample = async () => {
    if (stopped || sampling) return;
    sampling = true;
    let input = 0;
    let output = 0;
    try {
      input = inputAnalyser?.read() ?? 0;
      const reports = await peerConnection.getStats();
      reports.forEach((raw) => {
        const report = raw as AudioLevelStat;
        const audio = report.kind === "audio" || report.mediaType === "audio";
        if (!audio || typeof report.audioLevel !== "number" || !Number.isFinite(report.audioLevel)) return;
        if (report.type === "media-source") input = Math.max(input, report.audioLevel);
        if (report.type === "inbound-rtp") output = Math.max(output, report.audioLevel);
      });
    } catch {
      // Safari may omit audioLevel or temporarily reject getStats. The local
      // track analyser remains an enhancement; state motion never depends on it.
    } finally {
      voiceInputEnergy.set(Math.min(1, Math.max(0, input)));
      voiceOutputEnergy.set(Math.min(1, Math.max(0, output)));
      sampling = false;
    }
  };
  const timer = window.setInterval(() => void sample(), intervalMs);
  void sample();
  return () => {
    stopped = true;
    window.clearInterval(timer);
    inputAnalyser?.close();
    resetVoiceAudioEnergy();
  };
}
