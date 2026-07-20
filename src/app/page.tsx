"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from "motion/react";
import { ArrowLeft, Check, Mic } from "lucide-react";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import {
  CalibrationProfileReview,
  lastAnsweredCalibrationIndex,
  OnboardingCalibration,
} from "@/components/calibration/onboarding-calibration";
import { EditablePreferenceSignals, FineTuneVoice } from "@/components/preferences/fine-tune-voice";
import { ConversationalOnboarding } from "@/components/onboarding/conversational-onboarding";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { copy } from "@/content/copy";
import { buildPreferenceProfile } from "@/domain/preferences/calibration";
import { lessPreferenceOptions, morePreferenceOptions, preferenceDeltaForOption, type ExplicitPreferenceOption } from "@/domain/preferences/explicit-options";
import { applyPreferenceDelta, rebuildProfileFromSignals, removePreferenceSignal } from "@/domain/preferences/profile-mutations";
import { type CalibrationResponse, type PreferenceDelta, type PreferenceProfile, type PreferenceSignal, type WardrobeDirection } from "@/domain/schemas";
import { unlockSounds } from "@/lib/audio/sound-system";
import { calmSpring } from "@/lib/motion/tokens";
import { requestPersistentStorage, savePreferences, seedWardrobe, setExperienceMode } from "@/lib/storage/db";
import { demoWardrobe } from "@/mocks/wardrobe";

type Stage = "intro" | "permission" | "denied" | "direction" | "calibrate" | "preferences" | "profile" | "setup";

const directions: { id: WardrobeDirection; title: string; body: string }[] = [
  { id: "womenswear", title: "Womenswear", body: "Most clothes I plan to add are womenswear." },
  { id: "menswear", title: "Menswear", body: "Most clothes I plan to add are menswear." },
  { id: "mixed", title: "Mix both", body: "My wardrobe moves across both directions." },
  { id: "neutral", title: "No label", body: "Use the clothes I add without a wardrobe label." },
];

export default function FirstRunPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("intro");
  const [direction, setDirection] = useState<WardrobeDirection>("neutral");
  const [calibrationQuestionIndex, setCalibrationQuestionIndex] = useState(0);
  const [calibrationResponses, setCalibrationResponses] = useState<CalibrationResponse[]>([]);
  const calibrationResponsesRef = useRef<CalibrationResponse[]>([]);
  const calibrationHistoryRef = useRef<CalibrationResponse[][]>([]);
  const [calibrationHistoryDepth, setCalibrationHistoryDepth] = useState(0);
  const [calibrationPresentationSeed, setCalibrationPresentationSeed] = useState(0);
  const calibrationPresentationSeedRef = useRef<number | null>(null);
  const calibrationProfile = useMemo(() => buildPreferenceProfile({
    direction,
    responses: calibrationResponses,
  }), [calibrationResponses, direction]);
  const [profileDraft, setProfileDraft] = useState<PreferenceProfile>(calibrationProfile);
  const profileDraftRef = useRef(profileDraft);
  const preferenceMutationQueueRef = useRef<Promise<PreferenceProfile>>(Promise.resolve(profileDraft));
  const pendingPreferenceMutationsRef = useRef(0);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [preferenceMutationError, setPreferenceMutationError] = useState(false);
  const preferenceMutationErrorRef = useRef(false);
  const finishingRef = useRef(false);
  const [finishingMode, setFinishingMode] = useState<"demo" | "personal" | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);

  useEffect(() => {
    const previous = profileDraftRef.current;
    const explicitSignals = (previous.preferenceSignals ?? [])
      .filter((signal) => signal.provenance.source !== "calibration_pairwise");
    const next = rebuildProfileFromSignals({
      profile: {
        ...calibrationProfile,
        revision: Math.max(calibrationProfile.revision ?? 0, previous.revision ?? 0),
        evidence: previous.evidence,
      },
      signals: [...(calibrationProfile.preferenceSignals ?? []), ...explicitSignals],
    });
    profileDraftRef.current = next;
    setProfileDraft(next);
  }, [calibrationProfile]);

  useEffect(() => {
    if (localStorage.getItem("yiyi:onboarding-complete") === "true") router.replace("/today");
  }, [router]);

  async function requestMicrophone() {
    await unlockSounds();
    if (process.env.NEXT_PUBLIC_VOICE_MODE === "mock") { setStage("direction"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setStage("direction");
    } catch { setStage("denied"); }
  }

  function undoCalibrationAnswer() {
    const previous = calibrationHistoryRef.current.at(-1);
    if (!previous) return;
    const current = calibrationResponsesRef.current;
    const changedResponse = current.find((response) => {
      const prior = previous.find((candidate) => candidate.questionId === response.questionId);
      return !prior || prior.choice !== response.choice || prior.createdAt !== response.createdAt;
    }) ?? previous.find((response) => !current.some((candidate) => candidate.questionId === response.questionId));
    calibrationHistoryRef.current = calibrationHistoryRef.current.slice(0, -1);
    calibrationResponsesRef.current = previous;
    setCalibrationHistoryDepth(calibrationHistoryRef.current.length);
    setCalibrationResponses(previous);
    setCalibrationQuestionIndex(changedResponse ? lastAnsweredCalibrationIndex([changedResponse]) : lastAnsweredCalibrationIndex(previous));
    setStage("calibrate");
  }

  function recordCalibrationResponses(next: CalibrationResponse[]) {
    calibrationHistoryRef.current = [...calibrationHistoryRef.current, calibrationResponsesRef.current].slice(-50);
    calibrationResponsesRef.current = next;
    setCalibrationHistoryDepth(calibrationHistoryRef.current.length);
    setCalibrationResponses(next);
  }

  function beginCalibration() {
    if (calibrationPresentationSeedRef.current === null) {
      const seed = window.crypto.getRandomValues(new Uint32Array(1))[0] & 1;
      calibrationPresentationSeedRef.current = seed;
      setCalibrationPresentationSeed(seed);
    }
    setStage("calibrate");
  }

  function persistProfileMutation(mutator: (profile: PreferenceProfile) => PreferenceProfile) {
    pendingPreferenceMutationsRef.current += 1;
    setPreferenceSaving(true);
    preferenceMutationErrorRef.current = false;
    setPreferenceMutationError(false);
    const operation = preferenceMutationQueueRef.current
      .catch(() => profileDraftRef.current)
      .then(async () => {
        const next = mutator(profileDraftRef.current);
        await savePreferences(next);
        profileDraftRef.current = next;
        setProfileDraft(next);
        return next;
      });
    preferenceMutationQueueRef.current = operation.catch(() => profileDraftRef.current);
    void operation.catch(() => {
      preferenceMutationErrorRef.current = true;
      setPreferenceMutationError(true);
    });
    const finishPreferenceMutation = () => {
      pendingPreferenceMutationsRef.current -= 1;
      if (pendingPreferenceMutationsRef.current === 0) setPreferenceSaving(false);
    };
    void operation.then(finishPreferenceMutation, finishPreferenceMutation);
    return operation;
  }

  function saveExplicitDelta(delta: PreferenceDelta) {
    return persistProfileMutation((profile) => applyPreferenceDelta({ profile, delta, source: "explicit_voice" }));
  }

  function toggleExplicitOption(option: ExplicitPreferenceOption, selectedSignal: PreferenceSignal | undefined) {
    const operation = selectedSignal
      ? persistProfileMutation((profile) => removePreferenceSignal({ profile, signalId: selectedSignal.id, source: "profile_edit" }))
      : persistProfileMutation((profile) => applyPreferenceDelta({ profile, delta: preferenceDeltaForOption(option.id), source: "profile_edit" }));
    return operation.catch(() => profileDraftRef.current);
  }

  function removeExplicitSignal(signalId: string) {
    return persistProfileMutation((profile) => removePreferenceSignal({ profile, signalId, source: "profile_edit" })).then(() => undefined, () => undefined);
  }

  async function finish(mode: "demo" | "personal") {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishingMode(mode);
    setFinishError(null);
    try {
      await preferenceMutationQueueRef.current;
      if (preferenceMutationErrorRef.current) throw new Error("A preference mutation failed before setup completion.");
      await setExperienceMode(mode, mode === "demo");
      if (mode === "demo") await seedWardrobe(demoWardrobe, { explicit: true });
      await savePreferences(profileDraftRef.current);
      await requestPersistentStorage();
      localStorage.setItem("yiyi:onboarding-complete", "true");
      router.push(mode === "demo" ? "/today" : "/wardrobe/add");
    } catch {
      setFinishError("Setup wasn’t saved. Your choices are still here — try again.");
    } finally {
      finishingRef.current = false;
      setFinishingMode(null);
    }
  }

  return (
    <main className="phone-page">
      <AnimatePresence initial={false} mode="popLayout">
        {stage === "intro" && <ConversationalOnboarding key="intro" onComplete={() => setStage("permission")} />}
        {(stage === "permission" || stage === "denied") && <Permission key={stage} denied={stage === "denied"} onAllow={requestMicrophone} />}
        {stage === "direction" && <DirectionScreen key="direction" selected={direction} onChange={setDirection} onNext={beginCalibration} />}
        {stage === "calibrate" && <Screen key={`calibration-${calibrationQuestionIndex}`} className="calibration-screen"><OnboardingCalibration questionIndex={calibrationQuestionIndex} responses={calibrationResponses} presentationSeed={calibrationPresentationSeed} onQuestionIndexChange={setCalibrationQuestionIndex} onResponses={recordCalibrationResponses} onBack={() => setStage("direction")} onFinish={() => setStage("preferences")} /></Screen>}
        {stage === "preferences" && <PreferenceScreen key="preferences" profile={profileDraft} saving={preferenceSaving} saveError={preferenceMutationError} onSaveDelta={saveExplicitDelta} onProfileChange={(profile) => { profileDraftRef.current = profile; setProfileDraft(profile); }} onToggleOption={toggleExplicitOption} onRemoveSignal={removeExplicitSignal} onBack={() => { setCalibrationQuestionIndex(lastAnsweredCalibrationIndex(calibrationResponses)); setStage("calibrate"); }} onNext={() => setStage("profile")} />}
        {stage === "profile" && <Screen key="profile" className="profile-review"><CalibrationProfileReview direction={direction} profile={profileDraft} canUndo={calibrationHistoryDepth > 0} disabled={preferenceSaving} onBack={() => setStage("preferences")} onEdit={() => { setCalibrationQuestionIndex(0); setStage("calibrate"); }} onUndo={undoCalibrationAnswer} onNext={() => setStage("setup")} /></Screen>}
        {stage === "setup" && <WardrobeSetup key="setup" busy={finishingMode !== null} error={finishError} onBack={() => setStage("profile")} onExample={() => void finish("demo")} onPersonal={() => void finish("personal")} />}
      </AnimatePresence>
    </main>
  );
}

function Screen({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduceMotion = useReducedMotionConfig();
  const isPresent = useIsPresent();
  return <motion.section className={`page-column onboarding-screen ${className}`} aria-hidden={!isPresent} inert={!isPresent ? true : undefined} style={{ pointerEvents: isPresent ? "auto" : "none" }} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 14, scale: 0.995 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10, scale: 0.998 }} transition={reduceMotion ? { duration: 0.12 } : calmSpring}>{children}</motion.section>;
}

function Permission({ denied, onAllow }: { denied: boolean; onAllow: () => void }) {
  return <Screen><div className="center-stage"><div><span className="permission-icon"><Mic size={28} /></span><h1 className="page-title">{denied ? "Microphone access is off" : copy.permission.title}</h1><p className="body-copy permission-copy">{denied ? copy.permission.denied : copy.permission.body}</p></div></div><div className="permission-actions"><PrimaryButton onClick={onAllow}>{denied ? "Try Microphone Again" : copy.permission.allow}</PrimaryButton>{denied && <SecondaryButton onClick={() => window.open("app-settings:")}>{copy.permission.settings}</SecondaryButton>}</div></Screen>;
}

function DirectionScreen({ selected, onChange, onNext }: { selected: WardrobeDirection; onChange: (value: WardrobeDirection) => void; onNext: () => void }) {
  return <Screen><header className="onboarding-heading"><h1>How would you describe your wardrobe?</h1><p>This is a label for your wardrobe, not your identity or a hidden style rule. You can change it anytime.</p></header><div className="direction-list">{directions.map((direction) => <button key={direction.id} aria-pressed={selected === direction.id} className={`direction-option ${selected === direction.id ? "selected" : ""}`} onClick={() => onChange(direction.id)}><span><strong>{direction.title}</strong><small>{direction.body}</small></span><i>{selected === direction.id && <Check size={16} />}</i></button>)}</div><div className="bottom-bar"><PrimaryButton onClick={onNext}>Continue</PrimaryButton></div></Screen>;
}

function selectedOptionSignal(profile: PreferenceProfile, option: ExplicitPreferenceOption) {
  return (profile.preferenceSignals ?? []).find((signal) => signal.status !== "deleted" && signal.label === option.label && signal.polarity === option.polarity);
}

function PreferenceOptionGroup({ title, body, options, profile, disabled, onToggle }: { title: string; body: string; options: ExplicitPreferenceOption[]; profile: PreferenceProfile; disabled: boolean; onToggle: (option: ExplicitPreferenceOption, signal: PreferenceSignal | undefined) => void }) {
  return <section><h1>{title}</h1><p>{body}</p><div className="chip-row preference-chips">{options.map((option) => {
    const selected = selectedOptionSignal(profile, option);
    return <button className={`chip ${selected ? "selected" : ""}`} aria-pressed={Boolean(selected)} disabled={disabled} key={option.id} onClick={() => onToggle(option, selected)}>{option.label}</button>;
  })}</div></section>;
}

function PreferenceScreen({ profile, saving, saveError, onSaveDelta, onProfileChange, onToggleOption, onRemoveSignal, onBack, onNext }: { profile: PreferenceProfile; saving: boolean; saveError: boolean; onSaveDelta: (delta: PreferenceDelta) => Promise<PreferenceProfile>; onProfileChange: (profile: PreferenceProfile) => void; onToggleOption: (option: ExplicitPreferenceOption, signal: PreferenceSignal | undefined) => void; onRemoveSignal: (signalId: string) => Promise<void>; onBack: () => void; onNext: () => void }) {
  const optionLabels = new Set([...morePreferenceOptions, ...lessPreferenceOptions].map((option) => option.label));
  const customProfile = {
    ...profile,
    preferenceSignals: (profile.preferenceSignals ?? []).filter((signal) => signal.provenance.source !== "calibration_pairwise" && !optionLabels.has(signal.label)),
  };
  const customSignals = customProfile.preferenceSignals.filter((signal) => signal.status !== "deleted" && signal.polarity !== "unknown");
  const voiceOnlyProfile = { ...customProfile, preferenceSignals: [] };
  return <Screen className="preference-onboarding"><div className="topbar"><button className="icon-button" disabled={saving} onClick={onBack} aria-label="Back"><ArrowLeft /></button><div className="topbar-title">Fine-tune YiYi</div><span /></div><div className="preference-scroll"><PreferenceOptionGroup title="More of" body="What would you enjoy seeing more often?" options={morePreferenceOptions} profile={profile} disabled={saving} onToggle={onToggleOption} /><PreferenceOptionGroup title="Less of" body="What should YiYi reduce or avoid?" options={lessPreferenceOptions} profile={profile} disabled={saving} onToggle={onToggleOption} />{customSignals.length > 0 && <EditablePreferenceSignals signals={customSignals} onRemove={onRemoveSignal} />}</div>{saveError && <p className="preference-save-error" role="alert">That preference wasn’t saved. Try again before continuing.</p>}<FineTuneVoice profile={voiceOnlyProfile} onSaveDelta={onSaveDelta} onProfileChange={onProfileChange} onRemoveSignal={onRemoveSignal} /><div className="bottom-bar"><PrimaryButton disabled={saving || saveError} onClick={onNext}>{saving ? "Saving…" : "Review my style"}</PrimaryButton></div></Screen>;
}

function WardrobeSetup({ busy, error, onBack, onExample, onPersonal }: { busy: boolean; error: string | null; onBack: () => void; onExample: () => void; onPersonal: () => void }) {
  return <Screen><div className="topbar"><button className="icon-button" disabled={busy} onClick={onBack} aria-label="Back"><ArrowLeft /></button><span /><span /></div><div className="center-stage"><div><YiYiMark size={78} /><h1 className="page-title setup-title">Make it yours.</h1><p className="body-copy setup-copy">Try YiYi instantly, or add a few tops, bottoms, shoes, and accessories from your own wardrobe.</p></div></div>{error && <p className="preference-save-error" role="alert">{error}</p>}<div className="setup-actions" aria-busy={busy}><PrimaryButton disabled={busy} onClick={onExample}>{busy ? "Saving setup…" : "Try the example wardrobe"}</PrimaryButton><SecondaryButton disabled={busy} onClick={onPersonal}>Add my clothes</SecondaryButton></div></Screen>;
}
