"use client";

import { YiYiMark } from "@/components/brand/yiyi-mark";
import { motion, useReducedMotionConfig } from "motion/react";
import { motionDuration, motionEase, quickSpring } from "@/lib/motion/tokens";
import { useSyncExternalStore } from "react";

export type VoiceVisualState =
  | "idle"
  | "connecting"
  | "listening"
  | "committing"
  | "understanding"
  | "tool_running"
  | "revising"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error"
  | "recoverable_error";

function expressionFor(state: VoiceVisualState) {
  if (state === "speaking") return "speaking" as const;
  if (state === "listening") return "listening" as const;
  return "idle" as const;
}

function fieldMotion(state: VoiceVisualState, reduceMotion: boolean) {
  if (reduceMotion) return {
    animate: { opacity: ["error", "recoverable_error"].includes(state) ? 0.45 : 0.72 },
    transition: { duration: motionDuration.short },
  };
  if (state === "idle") return { animate: { scale: [0.995, 1.008, 0.995], opacity: [0.62, 0.7, 0.62] }, transition: { duration: 4.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" as const } };
  if (state === "connecting") return { animate: { scale: [0.96, 1.01], opacity: [0.48, 0.76] }, transition: { duration: 1.1, repeat: 1, repeatType: "reverse" as const, ease: motionEase.standard } };
  if (state === "listening") return { animate: { scale: [0.985, 1.025, 0.985], opacity: [0.56, 0.82, 0.56] }, transition: { duration: 2.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" as const } };
  if (state === "committing") return { animate: { scale: [1.04, 0.94, 0.98], opacity: [0.78, 0.5, 0.68] }, transition: { duration: 0.42, ease: motionEase.standard } };
  if (["thinking", "understanding", "tool_running"].includes(state)) return { animate: { scale: [1.025, 0.985, 1], opacity: [0.68, 0.82, 0.68] }, transition: { duration: 1.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" as const } };
  if (state === "revising") return { animate: { scale: [1, 1.045, 1], opacity: [0.68, 0.86, 0.72] }, transition: { duration: 0.5, ease: motionEase.standard } };
  if (state === "speaking") return { animate: { scale: [0.985, 1.035, 0.985], opacity: [0.62, 0.9, 0.62] }, transition: { duration: 1.05, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" as const } };
  if (state === "interrupted") return { animate: { scale: [1, 0.92, 1], opacity: [0.72, 0.45, 0.72] }, transition: { duration: 0.28, ease: motionEase.standard } };
  return { animate: { scale: 1, opacity: 0.45 }, transition: { duration: motionDuration.standard, ease: motionEase.standard } };
}

function useHydratedReducedMotion() {
  const configured = Boolean(useReducedMotionConfig());
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  return hydrated && configured;
}

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
  const reduceMotion = useHydratedReducedMotion();
  const field = fieldMotion(visualState, reduceMotion);
  const contents = <>
    <motion.span className="voice-core-field" aria-hidden="true" animate={field.animate} transition={field.transition}><span /><span /><span /></motion.span>
    <motion.span className="voice-core-mark" animate={!reduceMotion && visualState === "speaking" ? { y: [0, -1, 0] } : !reduceMotion && visualState === "interrupted" ? { scale: [1, 0.94, 1] } : { y: 0, scale: 1 }} transition={visualState === "speaking" ? { duration: 0.76, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" } : quickSpring}>
      <YiYiMark size={72} expression={expressionFor(visualState)} />
    </motion.span>
  </>;
  if (!onClick) return <div className="voice-core" data-state={visualState} role="img" aria-label={label}>{contents}</div>;
  return <motion.button className="voice-core" data-state={visualState} type="button" onClick={onClick} aria-label={label} disabled={disabled} whileTap={reduceMotion || disabled ? undefined : { scale: 0.95 }}>{contents}</motion.button>;
}

export function VoiceStatusMark({ state, label }: { state: VoiceVisualState; label: string }) {
  const reduceMotion = useHydratedReducedMotion();
  const field = fieldMotion(state, reduceMotion);
  return <motion.span className="voice-status-mark" data-state={state} role="img" aria-label={label} animate={field.animate} transition={field.transition}><YiYiMark size={27} expression={expressionFor(state)} /></motion.span>;
}

function primaryLabel(state: VoiceVisualState) {
  if (state === "listening") return "Done speaking";
  if (state === "speaking") return "Interrupt YiYi";
  if (["error", "recoverable_error"].includes(state)) return "Retry live voice";
  return "Start live voice session";
}

export function VoiceDock({ state, status, onPrimary, active = false, disabled = false }: {
  state: VoiceVisualState;
  status: string;
  onPrimary?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const reduceMotion = useHydratedReducedMotion();
  const interactive = Boolean(onPrimary) && ["idle", "listening", "speaking", "error", "recoverable_error"].includes(state);
  const ringActive = state === "listening" || state === "speaking";
  const primaryContents = <>
    <span className="voice-dock-rings" aria-hidden="true">
      <motion.i animate={!reduceMotion && ringActive ? { scale: [0.92, 1.34], opacity: [0.48, 0] } : state === "committing" ? { scale: [1.22, 0.94], opacity: [0, 0.5] } : { scale: 1, opacity: 0 }} transition={!reduceMotion && ringActive ? { duration: state === "speaking" ? 1.25 : 1.9, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" } : { duration: 0.34, ease: motionEase.standard }} />
      <motion.i animate={!reduceMotion && ringActive ? { scale: [0.9, 1.27], opacity: [0.32, 0] } : { scale: 1, opacity: 0 }} transition={!reduceMotion && ringActive ? { duration: state === "speaking" ? 1.25 : 2.15, delay: 0.32, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" } : { duration: motionDuration.short }} />
    </span>
    <motion.span animate={!reduceMotion && state === "revising" ? { scale: [1, 1.06, 1] } : !reduceMotion && state === "interrupted" ? { scale: [1, 0.92, 1] } : { scale: 1 }} transition={state === "revising" ? { duration: 0.48, ease: motionEase.standard } : quickSpring}>
      <YiYiMark size={46} expression={expressionFor(state)} />
    </motion.span>
  </>;
  return <div className="voice-dock" data-active={active} data-state={state}>
    {interactive
      ? <motion.button className="voice-dock-primary" type="button" onClick={onPrimary} disabled={disabled} aria-label={primaryLabel(state)} whileTap={reduceMotion || disabled ? undefined : { scale: 0.91 }} transition={quickSpring}>{primaryContents}</motion.button>
      : <motion.div className="voice-dock-primary" role="img" aria-label={status}>{primaryContents}</motion.div>}
    <span className="voice-dock-status" aria-live="polite">{status}</span>
  </div>;
}
