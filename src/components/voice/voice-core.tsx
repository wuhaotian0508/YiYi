import { YiYiMark } from "@/components/brand/yiyi-mark";

export function VoiceCore({ active, onClick, label = "Start live voice session", disabled = false }: { active: boolean; onClick?: () => void; label?: string; disabled?: boolean }) {
  return (
    <button className="voice-core" data-active={active} type="button" onClick={onClick} aria-label={label} disabled={disabled}>
      <YiYiMark size={72} expression={active ? "listening" : "idle"} />
    </button>
  );
}
