import { YiYiMark } from "@/components/brand/yiyi-mark";
import { MicOff, PhoneOff, Volume2 } from "lucide-react";

export type VoiceVisualState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "interrupted" | "error";

export function VoiceCore({
  active,
  state,
  onClick,
  label = "Start live voice session",
  disabled = false,
}: {
  active?: boolean;
  state?: VoiceVisualState;
  onClick?: () => void;
  label?: string;
  disabled?: boolean;
}) {
  const visualState = state ?? (active ? "listening" : "idle");
  const contents = <>
      <span className="voice-core-field" aria-hidden="true"><span /><span /><span /></span>
      <span className="voice-core-mark">
        <YiYiMark size={72} expression={visualState === "speaking" ? "speaking" : visualState === "listening" ? "listening" : "idle"} />
      </span>
    </>;
  if (!onClick) return <div className="voice-core" data-state={visualState} role="img" aria-label={label}>{contents}</div>;
  return <button className="voice-core" data-state={visualState} type="button" onClick={onClick} aria-label={label} disabled={disabled}>{contents}</button>;
}

export function VoiceStatusMark({ state, label }: { state: VoiceVisualState; label: string }) {
  return (
    <span className="voice-status-mark" data-state={state} role="img" aria-label={label}>
      <YiYiMark size={27} expression={state === "speaking" ? "speaking" : "idle"} />
    </span>
  );
}

export function VoiceDock({
  state,
  status,
  onPrimary,
  active = false,
  muted = false,
  onMute,
  onEnd,
  disabled = false,
}: {
  state: VoiceVisualState;
  status: string;
  onPrimary?: () => void;
  active?: boolean;
  muted?: boolean;
  onMute?: () => void;
  onEnd?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="voice-dock" data-active={active} data-state={state}>
      {active && onMute && (
        <button className="voice-dock-side" type="button" onClick={onMute} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <Volume2 size={18} /> : <MicOff size={18} />}
        </button>
      )}
      <button className="voice-dock-primary" type="button" onClick={onPrimary} disabled={disabled} aria-label={active ? status : "Start live voice session"}>
        <span className="voice-dock-rings" aria-hidden="true"><i /><i /></span>
        <YiYiMark size={46} expression={state === "speaking" ? "speaking" : state === "listening" ? "listening" : "idle"} />
      </button>
      {active && onEnd && (
        <button className="voice-dock-side" type="button" onClick={onEnd} aria-label="End session"><PhoneOff size={18} /></button>
      )}
      <span className="voice-dock-status" aria-live="polite">{status}</span>
    </div>
  );
}
