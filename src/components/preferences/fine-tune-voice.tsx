"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Trash2 } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotionConfig } from "motion/react";
import { activeLongTermPreferenceSignals } from "@/domain/preferences/profile-mutations";
import { PreferenceDeltaSchema, type PreferenceDelta, type PreferenceProfile, type PreferenceSignal } from "@/domain/schemas";
import { unlockSounds } from "@/lib/audio/sound-system";
import { BrowserPreferenceVoiceAdapter, interpretMockPreferenceTranscript } from "@/lib/realtime/preference-voice-adapter";
import { OpenAIRealtimeVoiceAdapter, VoiceConnectionFailure, type VoiceSessionAdapter, type VoiceToolHandlers } from "@/lib/realtime/voice-session";
import { voiceSessionCoordinator, voiceSessionServerSnapshot, type VoiceSessionCoordinator } from "@/lib/realtime/voice-session-coordinator";

type FineTuneStatus = "idle" | "connecting" | "listening" | "understanding" | "saving" | "done" | "error";
type FineTuneVoiceMode = "live" | "mock";

export type FineTuneAdapterFactory = (input: {
  attemptId: string;
  generation: number;
  mode: FineTuneVoiceMode;
  handlers: VoiceToolHandlers;
}) => VoiceSessionAdapter;

export type FineTuneVoiceProps = {
  profile: PreferenceProfile;
  onSaveDelta: (delta: PreferenceDelta) => Promise<PreferenceProfile>;
  onProfileChange: (profile: PreferenceProfile) => void;
  onRemoveSignal?: (signalId: string) => Promise<void> | void;
  coordinator?: VoiceSessionCoordinator;
  voiceMode?: FineTuneVoiceMode;
  createAdapter?: FineTuneAdapterFactory;
};

function defaultAdapterFactory(input: Parameters<FineTuneAdapterFactory>[0]) {
  if (input.mode === "live") {
    return new OpenAIRealtimeVoiceAdapter(input.handlers, {
      attemptId: input.attemptId,
      sessionGeneration: input.generation,
      purpose: "fine-tune",
    });
  }
  return new BrowserPreferenceVoiceAdapter();
}

function errorCopy(input: { stage: string | null; code: string | null; persistenceFailed: boolean }) {
  if (input.persistenceFailed) return "YiYi understood you, but couldn’t save it. Try again.";
  if (input.stage === "permission") return "Microphone access is off. Check Settings and try again.";
  if (input.code === "RATE_LIMITED") return "Voice is busy right now. Try again shortly.";
  if (input.stage === "tool") return "YiYi couldn’t understand a lasting preference. Try a clearer phrase.";
  return "Voice didn’t start. Tap to retry.";
}

function statusCopy(status: FineTuneStatus, failure: ReturnType<typeof errorCopy>, doneMessage: string) {
  if (status === "connecting") return "Starting voice…";
  if (status === "listening") return "Listening…";
  if (status === "understanding") return "Understanding…";
  if (status === "saving") return "Saving preference…";
  if (status === "done") return doneMessage;
  if (status === "error") return failure;
  return "Tell YiYi something else";
}

function visibleSignals(profile: PreferenceProfile) {
  const durable = activeLongTermPreferenceSignals(profile);
  const review = (profile.preferenceSignals ?? []).filter((signal) => signal.status === "needs_review" && signal.polarity !== "unknown");
  return [...new Map([...durable, ...review].map((signal) => [signal.id, signal])).values()];
}

function normalizedPreferenceValue(value: string | null) {
  return (value ?? "").trim().toLocaleLowerCase("en-US").replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ");
}

export function EditablePreferenceSignals({ signals, onRemove }: { signals: PreferenceSignal[]; onRemove?: (signalId: string) => Promise<void> | void }) {
  const groups = [
    { polarity: "more" as const, title: "More of" },
    { polarity: "less" as const, title: "Less of" },
  ];
  return <LayoutGroup id="editable-preference-signals"><motion.div className="structured-preference-signals" layout>{groups.map((group) => {
    const values = signals.filter((signal) => signal.polarity === group.polarity && signal.status !== "deleted");
    return <motion.section layout="position" key={group.polarity}><h2>{group.title}</h2><div className="chip-row preference-chips"><AnimatePresence initial={false} mode="popLayout">{values.length ? values.map((signal) => <motion.span
      className="chip"
      key={signal.id}
      layout
      initial={{ opacity: 0, transform: "translateY(4px) scale(.98)" }}
      animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
      exit={{ opacity: 0, transform: "translateY(-3px) scale(.98)" }}
      transition={{ duration: .18, ease: [.23, 1, .32, 1] }}
    >{signal.label}{signal.status === "needs_review" && <small>Review</small>}{onRemove && <button type="button" aria-label={`Delete ${signal.label}`} onClick={() => void onRemove(signal.id)}><Trash2 size={13} /></button>}</motion.span>) : <motion.span className="secondary-copy" key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .14 }}>Nothing saved yet</motion.span>}</AnimatePresence></div></motion.section>;
  })}</motion.div></LayoutGroup>;
}

export function FineTuneVoice({
  profile,
  onSaveDelta,
  onProfileChange,
  onRemoveSignal,
  coordinator = voiceSessionCoordinator,
  voiceMode = process.env.NEXT_PUBLIC_VOICE_MODE === "live" ? "live" : "mock",
  createAdapter = defaultAdapterFactory,
}: FineTuneVoiceProps) {
  const reduceMotion = useReducedMotionConfig();
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, voiceSessionServerSnapshot);
  const [outcome, setOutcome] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [doneMessage, setDoneMessage] = useState("Added to your profile");
  const [localFailure, setLocalFailure] = useState<{ stage: string | null; code: string | null; persistenceFailed: boolean } | null>(null);
  const handledTranscriptRef = useRef<string | null>(null);
  const saveDeltaRef = useRef(onSaveDelta);
  const profileChangeRef = useRef(onProfileChange);
  const mountedRef = useRef(true);
  useEffect(() => { saveDeltaRef.current = onSaveDelta; }, [onSaveDelta]);
  useEffect(() => { profileChangeRef.current = onProfileChange; }, [onProfileChange]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void coordinator.stop("fine-tune", "cleanup");
    };
  }, [coordinator]);

  const saveStructuredDelta = useCallback(async (deltaInput: PreferenceDelta, generation: number) => {
    let delta: PreferenceDelta;
    try {
      delta = PreferenceDeltaSchema.parse(deltaInput);
    } catch {
      if (mountedRef.current && coordinator.isCurrent("fine-tune", generation)) {
        setLocalFailure({ stage: "tool", code: "PREFERENCE_DELTA_INVALID", persistenceFailed: false });
        setOutcome("error");
      }
      return { success: false, summary: "I couldn’t safely structure that preference." };
    }
    if (!coordinator.isCurrent("fine-tune", generation)) return { success: false, summary: "That voice session has ended." };
    setOutcome("saving");
    setLocalFailure(null);
    try {
      const updated = await saveDeltaRef.current(delta);
      if (!mountedRef.current || !coordinator.isCurrent("fine-tune", generation)) return { success: false, summary: "That voice session has ended." };
      profileChangeRef.current(updated);
      const saved = updated.preferenceSignals?.find((signal) => signal.id === delta.signalId)
        ?? updated.preferenceSignals?.filter((signal) => signal.status !== "deleted"
          && signal.provenance.source === "explicit_voice"
          && signal.attribute === delta.attribute
          && normalizedPreferenceValue(signal.value) === normalizedPreferenceValue(delta.value)
          && signal.polarity === delta.polarity
          && signal.label === delta.label)
          .sort((left, right) => right.provenance.createdAt - left.provenance.createdAt)[0];
      const needsReview = saved ? saved.status === "needs_review" : delta.needsReview || delta.attribute === "preference_note";
      setDoneMessage(needsReview ? "Saved for review" : "Added to your profile");
      setOutcome("done");
      return needsReview
        ? { success: true, summary: "Saved as an editable note for review." }
        : { success: true, summary: "Saved as an editable long-term preference." };
    } catch {
      if (mountedRef.current && coordinator.isCurrent("fine-tune", generation)) {
        setLocalFailure({ stage: "persistence", code: "PREFERENCE_SAVE_FAILED", persistenceFailed: true });
        setOutcome("error");
      }
      return { success: false, summary: "I understood that, but it was not saved." };
    }
  }, [coordinator]);

  useEffect(() => {
    const userTranscript = snapshot.latestUserTranscript;
    if (voiceMode !== "mock" || snapshot.owner !== "fine-tune" || !userTranscript?.final) return;
    const key = `${snapshot.generation}:${userTranscript.text}`;
    if (handledTranscriptRef.current === key) return;
    handledTranscriptRef.current = key;
    setOutcome("idle");
    setDoneMessage("Added to your profile");
    setLocalFailure(null);
    void (async () => {
      try {
        const deltas = interpretMockPreferenceTranscript(userTranscript.text);
        for (const delta of deltas) {
          const result = await saveStructuredDelta(delta, snapshot.generation);
          if (!result.success) return;
        }
        await coordinator.stop("fine-tune", "user");
      } catch (error) {
        const failure = error instanceof VoiceConnectionFailure
          ? error
          : new VoiceConnectionFailure({ stage: "tool", code: "PREFERENCE_NOT_UNDERSTOOD" });
        if (!mountedRef.current || !coordinator.isCurrent("fine-tune", snapshot.generation)) return;
        setLocalFailure({ stage: failure.stage, code: failure.code, persistenceFailed: false });
        setOutcome("error");
      }
    })();
  }, [coordinator, saveStructuredDelta, snapshot.generation, snapshot.latestUserTranscript, snapshot.owner, voiceMode]);

  async function start() {
    handledTranscriptRef.current = null;
    setOutcome("idle");
    setLocalFailure(null);
    await unlockSounds();
    try {
      await coordinator.start("fine-tune", ({ attemptId, generation }) => {
        const handlers: VoiceToolHandlers = {
          requestRecommendation: async () => ({ success: false, summary: "This session only captures a style preference." }),
          revise: async () => ({ success: false, summary: "This session only captures a style preference." }),
          confirm: async () => ({ success: false, summary: "This session only captures a style preference." }),
          setAvailability: async () => ({ success: false, summary: "This session only captures a style preference." }),
          savePreference: (delta) => saveStructuredDelta(delta, generation),
        };
        return createAdapter({ attemptId, generation, mode: voiceMode, handlers });
      });
    } catch (error) {
      const failure = error instanceof VoiceConnectionFailure
        ? error
        : new VoiceConnectionFailure({ stage: "lifecycle", code: "VOICE_START_FAILED" });
      if (!mountedRef.current) return;
      setLocalFailure({ stage: failure.stage, code: failure.code, persistenceFailed: false });
      setOutcome("error");
    }
  }

  let status: FineTuneStatus = "idle";
  if (outcome !== "idle") status = outcome;
  else if (snapshot.owner === "fine-tune") {
    if (snapshot.status === "connecting") status = "connecting";
    else if (snapshot.status === "thinking" || snapshot.status === "speaking") status = "understanding";
    else if (snapshot.status === "listening" || snapshot.status === "interrupted") status = "listening";
    else if (snapshot.status === "error" || snapshot.status === "rate_limited") status = "error";
  }
  const failure = localFailure ?? {
    stage: snapshot.owner === "fine-tune" ? snapshot.stage : null,
    code: snapshot.owner === "fine-tune" ? snapshot.errorCode : null,
    persistenceFailed: false,
  };
  const message = statusCopy(status, errorCopy(failure), doneMessage);
  const signals = visibleSignals(profile);

  return <motion.div className="fine-tune-voice" layout>
    <AnimatePresence initial={false}>{signals.length > 0 && <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><EditablePreferenceSignals signals={signals} onRemove={onRemoveSignal} /></motion.div>}</AnimatePresence>
    <div className="preference-voice-area" aria-live="polite">
      <motion.button
        type="button"
        className="preference-mic"
        data-state={status}
        disabled={status === "saving" || status === "connecting"}
        onClick={() => void start()}
        aria-label={status === "error" ? "Retry voice preference" : "Tell YiYi another preference"}
        whileTap={reduceMotion ? undefined : { transform: "scale(.94)" }}
        animate={reduceMotion || (status !== "listening" && status !== "understanding")
          ? { transform: "scale(1)" }
          : { transform: ["scale(1)", "scale(1.035)", "scale(1)"] }}
        transition={reduceMotion ? { duration: .12 } : status === "listening" || status === "understanding"
          ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
          : { duration: .18, ease: [.23, 1, .32, 1] }}
      >
        <Mic size={22} />
      </motion.button>
      <span data-voice-message-state={status}>{message}</span>
    </div>
  </motion.div>;
}
