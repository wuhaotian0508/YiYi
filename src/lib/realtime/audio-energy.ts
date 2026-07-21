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

export function startVoiceAudioEnergySampler(peerConnection: RTCPeerConnection, intervalMs = 80) {
  let stopped = false;
  let sampling = false;
  const sample = async () => {
    if (stopped || sampling) return;
    sampling = true;
    try {
      const reports = await peerConnection.getStats();
      let input = 0;
      let output = 0;
      reports.forEach((raw) => {
        const report = raw as AudioLevelStat;
        const audio = report.kind === "audio" || report.mediaType === "audio";
        if (!audio || typeof report.audioLevel !== "number" || !Number.isFinite(report.audioLevel)) return;
        if (report.type === "media-source") input = Math.max(input, report.audioLevel);
        if (report.type === "inbound-rtp") output = Math.max(output, report.audioLevel);
      });
      voiceInputEnergy.set(Math.min(1, Math.max(0, input)));
      voiceOutputEnergy.set(Math.min(1, Math.max(0, output)));
    } catch {
      // Some Safari versions omit audioLevel. State motion remains available
      // and the energy values stay at zero rather than failing the voice flow.
    } finally {
      sampling = false;
    }
  };
  const timer = window.setInterval(() => void sample(), intervalMs);
  void sample();
  return () => {
    stopped = true;
    window.clearInterval(timer);
    resetVoiceAudioEnergy();
  };
}
