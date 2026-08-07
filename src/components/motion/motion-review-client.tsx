"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { MotionConfig } from "motion/react";
import TodayPage from "@/app/today/page";
import {
  ConversationalOnboarding,
  onboardingStoryLabels,
  type OnboardingStoryLabel,
  type OnboardingTimelineController,
} from "@/components/onboarding/conversational-onboarding";
import { OnboardingCalibration } from "@/components/calibration/onboarding-calibration";
import { OutfitCanvas } from "@/components/outfit/outfit-canvas";
import { FineTuneVoice } from "@/components/preferences/fine-tune-voice";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { PrimaryButton } from "@/components/ui/buttons";
import { VoiceCore, VoiceDock, type VoiceVisualState } from "@/components/voice/voice-core";
import { applyPreferenceDelta, removePreferenceSignal } from "@/domain/preferences/profile-mutations";
import {
  OutfitSchema,
  type CalibrationResponse,
  type Outfit,
  type PreferenceDelta,
  type PreferenceProfile,
} from "@/domain/schemas";
import { demoPreferenceProfile, demoWardrobe } from "@/mocks/wardrobe";
import { DevFrameSampler } from "./frame-sampler";
import styles from "./motion-review-client.module.css";

type Scenario = "onboarding" | "voice" | "outfit" | "pager" | "calibration" | "fine-tune" | "sheet";
type MotionMode = "normal" | "reduced";

const viewports = {
  "375×667": { width: 375, height: 667 },
  "390×844": { width: 390, height: 844 },
  "393×852": { width: 393, height: 852 },
  "430×932": { width: 430, height: 932 },
} as const;

const outfitInitial: Outfit = OutfitSchema.parse({
  id: "98888888-8888-4888-8888-888888888881",
  itemIds: {
    outerwear: "11111111-1111-4111-8111-111111111113",
    top: "22222222-2222-4222-8222-222222222223",
    bottom: "33333333-3333-4333-8333-333333333332",
    shoes: "44444444-4444-4444-8444-444444444442",
    bag: "55555555-5555-4555-8555-555555555551",
  },
  deterministicScore: 9,
});

const outfitRevised: Outfit = OutfitSchema.parse({
  ...outfitInitial,
  id: "98888888-8888-4888-8888-888888888882",
  itemIds: { ...outfitInitial.itemIds, shoes: "44444444-4444-4444-8444-444444444441" },
});

const outfitRandom: Outfit = OutfitSchema.parse({
  id: "98888888-8888-4888-8888-888888888883",
  itemIds: {
    outerwear: "11111111-1111-4111-8111-111111111111",
    top: "22222222-2222-4222-8222-222222222221",
    bottom: "33333333-3333-4333-8333-333333333331",
    shoes: "44444444-4444-4444-8444-444444444441",
    bag: "55555555-5555-4555-8555-555555555552",
  },
  deterministicScore: 8.7,
});

export function MotionReviewClient() {
  const [scenario, setScenario] = useState<Scenario>("onboarding");
  const [motionMode, setMotionMode] = useState<MotionMode>("normal");
  const [viewportName, setViewportName] = useState<keyof typeof viewports>("390×844");
  const [reviewControlsHost, setReviewControlsHost] = useState<HTMLDivElement | null>(null);
  const viewport = viewports[viewportName];

  return <main className={styles.root} data-motion-review data-motion-mode={motionMode}>
    <header className={styles.toolbar}>
      <div className={styles.toolbarRow} aria-label="Review scenarios">{(["onboarding", "voice", "outfit", "pager", "calibration", "fine-tune", "sheet"] as Scenario[]).map((value) => <button type="button" key={value} data-active={scenario === value} onClick={() => setScenario(value)}>{value}</button>)}</div>
      <div className={styles.toolbarRow}>
        <button type="button" data-active={motionMode === "normal"} onClick={() => setMotionMode("normal")}>Normal motion</button>
        <button type="button" data-active={motionMode === "reduced"} onClick={() => setMotionMode("reduced")}>Reduced motion</button>
        <label><span className="sr-only">Review viewport</span><select aria-label="Review viewport" value={viewportName} onChange={(event) => setViewportName(event.target.value as keyof typeof viewports)}>{Object.keys(viewports).map((name) => <option key={name}>{name}</option>)}</select></label>
        <DevFrameSampler />
      </div>
      <div className={styles.reviewControlsHost} data-motion-review-controls ref={setReviewControlsHost} />
    </header>
    <MotionConfig reducedMotion={motionMode === "reduced" ? "always" : "never"}>
      <div className={styles.stage}>
        <div className={styles.device} data-review-viewport={viewportName} style={{ width: viewport.width, height: viewport.height }}>
          {scenario === "onboarding" && <OnboardingReview controlsHost={reviewControlsHost} />}
          {scenario === "voice" && <VoiceReview />}
          {scenario === "outfit" && <OutfitReview />}
          {scenario === "pager" && <TodayPage />}
          {scenario === "calibration" && <CalibrationReview />}
          {scenario === "fine-tune" && <FineTuneReview />}
          {scenario === "sheet" && <SheetReview />}
        </div>
      </div>
    </MotionConfig>
  </main>;
}

function OnboardingReview({ controlsHost }: { controlsHost: HTMLDivElement | null }) {
  const [controller, setController] = useState<OnboardingTimelineController | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<OnboardingStoryLabel>("arrival");
  const devtoolsHostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!controller || !devtoolsHostRef.current || process.env.NODE_ENV === "production") return;
    let cancelled = false;
    let devtools: { kill: () => void } | null = null;
    void import("gsap/GSDevTools").then(({ GSDevTools }) => {
      if (cancelled || !devtoolsHostRef.current) return;
      gsap.registerPlugin(GSDevTools);
      devtools = GSDevTools.create({ animation: controller.timeline, container: devtoolsHostRef.current, globalSync: false, hideGlobalTimeline: true, keyboard: true, minimal: true, paused: false });
    });
    return () => { cancelled = true; devtools?.kill(); };
  }, [controller, controlsHost]);

  const controls = <aside className={styles.timelineOverlay} aria-label="Onboarding timeline controls">
      <select aria-label="Storyboard label" value={selectedLabel} onChange={(event) => { const label = event.target.value as OnboardingStoryLabel; setSelectedLabel(label); controller?.seek(label); }}>{onboardingStoryLabels.map((label) => <option key={label}>{label}</option>)}</select>
      <button type="button" onClick={() => controller?.restart()}>Restart</button>
      {[1, .5, .25].map((scale) => <button type="button" key={scale} onClick={() => { controller?.timeScale(scale); controller?.play(); }}>{scale}×</button>)}
      <div className={styles.devtools} ref={devtoolsHostRef} data-gsdevtools-host />
    </aside>;
  return <div className={styles.onboardingReview} data-review-scenario="onboarding">
    <ConversationalOnboarding reviewMode onComplete={() => controller?.pause()} onTimelineReady={setController} />
    {controlsHost ? createPortal(controls, controlsHost) : controls}
  </div>;
}

function VoiceReview() {
  const [state, setState] = useState<VoiceVisualState>("idle");
  const active = state !== "idle" && state !== "error";
  return <section className={styles.simpleScenario} data-review-scenario="voice">
    <h1>Voice states</h1><p>Production Voice Core and Dock driven from one explicit state.</p>
    <div className={styles.stateRail}>{(["idle", "connecting", "listening", "committing", "understanding", "tool_running", "revising", "speaking", "interrupted", "recoverable_error"] as VoiceVisualState[]).map((value) => <button type="button" aria-pressed={state === value} key={value} onClick={() => setState(value)}>{value}</button>)}</div>
    <div className={styles.voicePreview}><VoiceCore state={state} label={`YiYi ${state}`} /></div>
    <VoiceDock state={state} status={state === "error" ? "Voice connection failed · Tap to retry" : state === "idle" ? "Tap to talk" : `${state[0].toUpperCase()}${state.slice(1)}…`} active={active} onPrimary={() => setState(active ? "interrupted" : "connecting")} />
  </section>;
}

function OutfitReview() {
  const [state, setState] = useState<"initial" | "revision" | "random" | "confirmed">("initial");
  const outfit = state === "revision" ? outfitRevised : state === "random" ? outfitRandom : outfitInitial;
  return <section className={styles.simpleScenario} data-review-scenario="outfit" data-outfit-state={state}>
    <h1>One current answer</h1><p>{state === "revision" ? "Only the shoes changed; every other slot keeps its geometry." : state === "random" ? "A meaningfully different legal answer." : state === "confirmed" ? "This exact answer is confirmed." : "Initial editorial flat-lay."}</p>
    <div className={styles.outfitPreview}><OutfitCanvas outfit={outfit} wardrobe={demoWardrobe} /></div>
    <div className={styles.scenarioActions}>
      <button type="button" aria-pressed={state === "initial"} onClick={() => setState("initial")}>Initial</button>
      <button type="button" aria-pressed={state === "revision"} onClick={() => setState("revision")}>Targeted revision</button>
      <button type="button" aria-pressed={state === "random"} onClick={() => setState("random")}>Random</button>
      <button type="button" onClick={() => setState("initial")}>Undo</button>
      <button type="button" aria-pressed={state === "confirmed"} onClick={() => setState("confirmed")}>Confirm</button>
    </div>
  </section>;
}

function CalibrationReview() {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [responses, setResponses] = useState<CalibrationResponse[]>([]);
  const [complete, setComplete] = useState(false);
  if (complete) return <section className={styles.simpleScenario} data-review-scenario="calibration-complete"><h1>Calibration complete</h1><p>{responses.filter((response) => response.choice !== "skip").length} explicit comparisons saved.</p><PrimaryButton onClick={() => { setQuestionIndex(0); setResponses([]); setComplete(false); }}>Review again</PrimaryButton></section>;
  return <section className={styles.simpleScenario} data-review-scenario="calibration"><OnboardingCalibration direction="neutral" questionIndex={questionIndex} responses={responses} onQuestionIndexChange={setQuestionIndex} onResponses={setResponses} onBack={() => setQuestionIndex(Math.max(0, questionIndex - 1))} onFinish={() => setComplete(true)} /></section>;
}

function FineTuneReview() {
  const [profile, setProfile] = useState<PreferenceProfile>(demoPreferenceProfile);
  async function save(delta: PreferenceDelta) {
    const next = applyPreferenceDelta({ profile, delta, source: "explicit_voice" });
    setProfile(next);
    return next;
  }
  function addReviewSignal(polarity: "more" | "less") {
    return save({
      action: "add",
      signalId: null,
      attribute: polarity === "more" ? "material" : "formality",
      value: polarity === "more" ? "soft" : "formal",
      label: polarity === "more" ? "Soft textures" : "Formal looks",
      polarity,
      strength: "soft",
      scope: "global_style",
      categories: [],
      slots: [],
      combinationValues: [],
      confidence: .98,
      needsReview: false,
      evidenceSummary: polarity === "more" ? "More soft textures" : "Less formal structure",
    });
  }
  return <section className={styles.simpleScenario} data-review-scenario="fine-tune">
    <h1>Fine-tune</h1>
    <p>Raw transcript stays hidden; only structured, editable signals appear.</p>
    <div className={styles.scenarioActions} aria-label="Fine-tune review controls">
      <button type="button" onClick={() => void addReviewSignal("more")}>Add More signal</button>
      <button type="button" onClick={() => void addReviewSignal("less")}>Add Less signal</button>
    </div>
    <FineTuneVoice profile={profile} voiceMode="mock" onSaveDelta={save} onProfileChange={setProfile} onRemoveSignal={(signalId) => setProfile((current) => removePreferenceSignal({ profile: current, signalId, source: "profile_edit" }))} />
  </section>;
}

function SheetReview() {
  const [open, setOpen] = useState(false);
  return <section className={styles.simpleScenario} data-review-scenario="sheet"><h1>Bottom Sheet</h1><p>Drag the handle, interrupt the return spring, or dismiss the scrim.</p><PrimaryButton className={styles.sheetLaunch} onClick={() => setOpen(true)}>Open sheet</PrimaryButton><BottomSheet open={open} onClose={() => setOpen(false)} label="Motion review sheet"><h2>Refine today</h2><p className="secondary-copy">The page track stays still while the sheet owns vertical drag.</p><PrimaryButton onClick={() => setOpen(false)}>Done</PrimaryButton></BottomSheet></section>;
}
