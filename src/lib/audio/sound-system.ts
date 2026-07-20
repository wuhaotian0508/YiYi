export type YiYiSound = "listen" | "understood" | "recommendation" | "replacement" | "confirmed" | "error";

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

let context: AudioContext | null = null;
let enabled = true;

export function configureSounds(nextEnabled: boolean) {
  enabled = nextEnabled;
}

function getContext() {
  if (typeof window === "undefined") return null;
  const Constructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!Constructor) return null;
  context ??= new Constructor();
  return context;
}

export async function unlockSounds() {
  const audio = getContext();
  if (audio?.state === "suspended") await audio.resume().catch(() => undefined);
}

function tone(audio: AudioContext, start: number, frequency: number, duration: number, volume: number, destination: AudioNode, endFrequency?: number) {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(volume, start + Math.min(0.018, duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
  return oscillator;
}

export function playSound(name: YiYiSound) {
  if (!enabled) return;
  const audio = getContext();
  if (!audio || audio.state !== "running") return;
  const master = audio.createGain();
  master.gain.value = 0.32;
  master.connect(audio.destination);
  const now = audio.currentTime + 0.004;
  let finalOscillator: OscillatorNode | null = null;

  if (name === "listen") finalOscillator = tone(audio, now, 360, 0.11, 0.14, master, 480);
  if (name === "understood") {
    tone(audio, now, 440, 0.13, 0.11, master, 520);
    finalOscillator = tone(audio, now + 0.085, 620, 0.15, 0.08, master);
  }
  if (name === "recommendation") {
    tone(audio, now, 392, 0.18, 0.1, master, 466);
    finalOscillator = tone(audio, now + 0.11, 587, 0.22, 0.075, master);
  }
  if (name === "replacement") finalOscillator = tone(audio, now, 510, 0.15, 0.1, master, 390);
  if (name === "confirmed") {
    tone(audio, now, 440, 0.18, 0.1, master);
    tone(audio, now + 0.12, 554, 0.19, 0.085, master);
    finalOscillator = tone(audio, now + 0.24, 659, 0.23, 0.07, master);
  }
  if (name === "error") {
    tone(audio, now, 290, 0.16, 0.1, master, 230);
    finalOscillator = tone(audio, now + 0.12, 220, 0.18, 0.07, master);
  }

  finalOscillator?.addEventListener("ended", () => master.disconnect(), { once: true });
}
