import { YiYiMark } from "@/components/brand/yiyi-mark";

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
  return (
    <button className="voice-core" data-state={visualState} type="button" onClick={onClick} aria-label={label} disabled={disabled}>
      <span className="voice-core-field" aria-hidden="true"><span /><span /><span /></span>
      <span className="voice-core-mark">
        <YiYiMark size={72} expression={visualState === "speaking" ? "speaking" : visualState === "listening" ? "listening" : "idle"} />
      </span>
    </button>
  );
}

export function VoiceStatusMark({ state, label }: { state: VoiceVisualState; label: string }) {
  return (
    <span className="voice-status-mark" data-state={state} role="img" aria-label={label}>
      <YiYiMark size={27} expression={state === "speaking" ? "speaking" : "idle"} />
    </span>
  );
}
