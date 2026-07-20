"use client";

import { YiYiMark } from "@/components/brand/yiyi-mark";
import { MicOff, PhoneOff, Volume2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { motionDuration, motionEase, quickSpring } from "@/lib/motion/tokens";

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
  const reduceMotion = useReducedMotionConfig();
  const fieldAnimate = reduceMotion ? { opacity: visualState === "error" ? 0.45 : 0.72 } : visualState === "listening"
    ? { scale: [0.98, 1.025, 0.98], opacity: [0.58, 0.82, 0.58] }
    : visualState === "thinking" || visualState === "connecting"
      ? { rotate: [0, 360], opacity: [0.58, 0.78, 0.58] }
      : visualState === "speaking"
        ? { scale: [0.985, 1.035, 0.985], opacity: [0.62, 0.9, 0.62] }
        : visualState === "interrupted"
          ? { scale: [1, 0.92, 1], opacity: [0.72, 0.45, 0.72] }
          : { scale: 1, rotate: 0, opacity: visualState === "error" ? 0.45 : 0.72 };
  const fieldTransition = reduceMotion ? { duration: motionDuration.short } : visualState === "thinking" || visualState === "connecting"
    ? { duration: visualState === "connecting" ? 2.8 : 4.8, repeat: Number.POSITIVE_INFINITY, ease: "linear" as const }
    : visualState === "listening" || visualState === "speaking"
      ? { duration: visualState === "speaking" ? 1.05 : 2.15, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" as const }
      : visualState === "interrupted"
        ? { duration: 0.32, ease: motionEase.standard }
        : { duration: motionDuration.standard, ease: motionEase.standard };
  const contents = visualState === "idle" ? <>
      <span className="voice-core-field" aria-hidden="true"><span /><span /><span /></span>
      <span className="voice-core-mark"><YiYiMark size={72} expression="idle" /></span>
    </> : <>
      <motion.span className="voice-core-field" aria-hidden="true" animate={fieldAnimate} transition={fieldTransition}><span /><span /><span /></motion.span>
      <motion.span className="voice-core-mark" animate={reduceMotion ? undefined : visualState === "speaking" ? { y: [0, -1, 0] } : visualState === "interrupted" ? { scale: [1, 0.94, 1] } : { y: 0, scale: 1 }} transition={visualState === "speaking" ? { duration: 0.76, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" } : visualState === "interrupted" ? { duration: 0.3, ease: motionEase.standard } : quickSpring}>
        <YiYiMark size={72} expression={visualState === "speaking" ? "speaking" : visualState === "listening" ? "listening" : "idle"} />
      </motion.span>
    </>;
  if (!onClick) return <div className="voice-core" data-state={visualState} role="img" aria-label={label}>{contents}</div>;
  return <motion.button className="voice-core" data-state={visualState} type="button" onClick={onClick} aria-label={label} disabled={disabled} whileTap={reduceMotion || disabled ? undefined : { scale: 0.95 }}>{contents}</motion.button>;
}

export function VoiceStatusMark({ state, label }: { state: VoiceVisualState; label: string }) {
  const reduceMotion = useReducedMotionConfig();
  return (
    <motion.span className="voice-status-mark" data-state={state} role="img" aria-label={label} animate={reduceMotion ? undefined : state === "listening" ? { scale: [1, 1.05, 1] } : state === "thinking" ? { rotate: [0, 360] } : state === "speaking" ? { y: [0, -1, 0] } : { scale: 1, rotate: 0, y: 0 }} transition={state === "thinking" ? { duration: 4.6, repeat: Number.POSITIVE_INFINITY, ease: "linear" } : { duration: 1.7, repeat: ["listening", "speaking"].includes(state) ? Number.POSITIVE_INFINITY : 0, ease: "easeInOut" }}>
      <YiYiMark size={27} expression={state === "speaking" ? "speaking" : "idle"} />
    </motion.span>
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
  const reduceMotion = useReducedMotionConfig();
  const ringActive = state === "listening" || state === "speaking";
  return (
    <div className="voice-dock" data-active={active} data-state={state}>
      <AnimatePresence initial={false}>{active && onMute && (
        <motion.button className="voice-dock-side voice-dock-mute" type="button" onClick={onMute} aria-label={muted ? "Unmute" : "Mute"} initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.94 }} transition={{ duration: motionDuration.short, ease: motionEase.standard }} whileTap={reduceMotion ? undefined : { scale: 0.9 }}>
          {muted ? <Volume2 size={18} /> : <MicOff size={18} />}
        </motion.button>
      )}</AnimatePresence>
      <motion.button className="voice-dock-primary" type="button" onClick={onPrimary} disabled={disabled} aria-label={active ? status : "Start live voice session"} whileTap={reduceMotion || disabled ? undefined : { scale: 0.91 }} animate={reduceMotion ? undefined : state === "interrupted" ? { scale: [1, 0.94, 1] } : { scale: 1 }} transition={state === "interrupted" ? { duration: 0.3, ease: motionEase.standard } : quickSpring}>
        <span className="voice-dock-rings" aria-hidden="true"><motion.i animate={!reduceMotion && ringActive ? { scale: [0.92, 1.34], opacity: [0.52, 0] } : { scale: 1, opacity: 0 }} transition={!reduceMotion && ringActive ? { duration: state === "speaking" ? 1.25 : 1.85, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" } : { duration: motionDuration.short }} /><motion.i animate={!reduceMotion && state === "speaking" ? { scale: [0.92, 1.28], opacity: [0.38, 0] } : { scale: 1, opacity: 0 }} transition={!reduceMotion && state === "speaking" ? { duration: 1.25, delay: 0.3, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" } : { duration: motionDuration.short }} /></span>
        <YiYiMark size={46} expression={state === "speaking" ? "speaking" : state === "listening" ? "listening" : "idle"} />
      </motion.button>
      <AnimatePresence initial={false}>{active && onEnd && (
        <motion.button className="voice-dock-side voice-dock-end" type="button" onClick={onEnd} aria-label="End session" initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.94 }} transition={{ duration: motionDuration.short, ease: motionEase.standard }} whileTap={reduceMotion ? undefined : { scale: 0.9 }}><PhoneOff size={18} /></motion.button>
      )}</AnimatePresence>
      <span className="voice-dock-status" aria-live="polite">{status}</span>
    </div>
  );
}
