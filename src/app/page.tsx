"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, Heart, Mic, RotateCcw, ThumbsDown, X } from "lucide-react";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import { OutfitCanvas } from "@/components/outfit/outfit-canvas";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { VoiceCore } from "@/components/voice/voice-core";
import { copy } from "@/content/copy";
import { buildPreferenceProfile } from "@/domain/preferences/calibration";
import { OutfitSchema, type Outfit, type StyleFeedback, type WardrobeDirection } from "@/domain/schemas";
import { unlockSounds } from "@/lib/audio/sound-system";
import { calmSpring } from "@/lib/motion/tokens";
import { requestPersistentStorage, savePreferences, seedWardrobe, setExperienceMode } from "@/lib/storage/db";
import { demoWardrobe } from "@/mocks/wardrobe";

type Stage = "splash" | "teach" | "understand" | "recommend" | "permission" | "denied" | "direction" | "calibrate" | "preferences" | "profile" | "setup";
type Sentiment = StyleFeedback["sentiment"];
type VoiceCaptureState = "idle" | "listening" | "understanding" | "done" | "error";

const directions: { id: WardrobeDirection; title: string; body: string }[] = [
  { id: "womenswear", title: "Womenswear", body: "Style primarily from womenswear silhouettes." },
  { id: "menswear", title: "Menswear", body: "Style primarily from menswear silhouettes." },
  { id: "mixed", title: "Mix both", body: "Move freely across both directions." },
  { id: "neutral", title: "No preference", body: "Let the wardrobe and your day lead." },
];
const moreOptions = ["Relaxed tailoring", "Clean layers", "Sporty pieces", "Soft textures", "Color", "Minimal looks"];
const lessOptions = ["Heels", "Tight fits", "Cropped tops", "Short skirts", "Bright colors", "Formal looks", "Gold-tone jewelry", "Silver-tone jewelry"];
const looks = [0, 1, 2, 3, 4, 5];

const recommendationBefore: Outfit = OutfitSchema.parse({
  id: "88888888-8888-4888-8888-888888888881",
  itemIds: {
    outerwear: "11111111-1111-4111-8111-111111111113",
    top: "22222222-2222-4222-8222-222222222223",
    bottom: "33333333-3333-4333-8333-333333333332",
    shoes: "44444444-4444-4444-8444-444444444442",
    bag: "55555555-5555-4555-8555-555555555551",
  },
  deterministicScore: 9,
});
const recommendationAfter: Outfit = OutfitSchema.parse({
  ...recommendationBefore,
  id: "88888888-8888-4888-8888-888888888882",
  itemIds: { ...recommendationBefore.itemIds, shoes: "44444444-4444-4444-8444-444444444441" },
});

function lookPosition(index: number, direction: WardrobeDirection) {
  const menswear = direction === "menswear" || (direction === "mixed" && index % 2 === 1) || (direction === "neutral" && index >= 3);
  return {
    "--look-x": `${(index % 3) * 50}%`,
    "--look-y": `${Math.floor(index / 3) * 100}%`,
    "--look-image": `url('/style-calibration/${menswear ? "style-grid-menswear.webp" : "style-grid.webp"}')`,
  } as React.CSSProperties;
}

function useNarrativeSteps(delays: number[]) {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reduceMotion) return;
    const timers = delays.map((delay, index) => window.setTimeout(() => setStep(index + 1), delay));
    return () => timers.forEach(window.clearTimeout);
  }, [delays, reduceMotion]);
  return reduceMotion ? delays.length : step;
}

type SpeechResultEvent = { results: ArrayLike<{ 0: { transcript: string } }> };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionWindow = Window & typeof globalThis & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

function usePreferenceVoice(onComplete: (text: string) => void) {
  const [state, setState] = useState<VoiceCaptureState>("idle");
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => () => recognitionRef.current?.stop(), []);

  async function start() {
    setTranscript("");
    setState("listening");
    await unlockSounds();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const speechWindow = window as SpeechRecognitionWindow;
      const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
      if (!Constructor) throw new Error("Speech recognition unavailable");
      const recognition = new Constructor();
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        const text = event.results[event.results.length - 1]?.[0]?.transcript?.trim() ?? "";
        if (!text) { setState("error"); return; }
        setTranscript(text);
        setState("understanding");
        window.setTimeout(() => { onComplete(text); setState("done"); }, 520);
      };
      recognition.onerror = () => setState("error");
      recognition.onend = () => setState((value) => value === "listening" ? "error" : value);
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setState("error");
    }
  }

  return { state, transcript, start, retry: () => void start() };
}

export default function FirstRunPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("splash");
  const [direction, setDirection] = useState<WardrobeDirection>("neutral");
  const [lookIndex, setLookIndex] = useState(0);
  const [feedback, setFeedback] = useState<StyleFeedback[]>([]);
  const [moreOf, setMoreOf] = useState<string[]>([]);
  const [lessOf, setLessOf] = useState<string[]>([]);
  const [freeform, setFreeform] = useState("");

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

  function recordFeedback(sentiment: Sentiment) {
    const lookId = `look-${lookIndex + 1}`;
    setFeedback((values) => [...values.filter((value) => value.lookId !== lookId), { lookId, sentiment }]);
    if (lookIndex < looks.length - 1) setLookIndex((value) => value + 1);
    else setStage("preferences");
  }

  function undoFeedback() {
    const previous = feedback.at(-1);
    if (!previous) return;
    setFeedback((values) => values.slice(0, -1));
    setLookIndex(Math.max(0, Number(previous.lookId.split("-")[1]) - 1));
    setStage("calibrate");
  }

  function buildProfile() {
    return buildPreferenceProfile({ direction, feedback, moreOf, lessOf, freeform });
  }

  async function finish(mode: "demo" | "personal") {
    await setExperienceMode(mode, mode === "demo");
    if (mode === "demo") await seedWardrobe(demoWardrobe, { explicit: true });
    await savePreferences(buildProfile());
    await requestPersistentStorage();
    localStorage.setItem("yiyi:onboarding-complete", "true");
    router.push(mode === "demo" ? "/today" : "/wardrobe/add");
  }

  return (
    <main className="phone-page">
      <AnimatePresence initial={false} mode="popLayout">
        {stage === "splash" && <Splash key="splash" onNext={() => setStage("teach")} />}
        {stage === "teach" && <Teaching key="teach" onNext={() => setStage("understand")} />}
        {stage === "understand" && <UnderstandingDemo key="understand" onNext={() => setStage("recommend")} />}
        {stage === "recommend" && <RecommendationDemo key="recommend" onNext={() => setStage("permission")} />}
        {(stage === "permission" || stage === "denied") && <Permission key={stage} denied={stage === "denied"} onAllow={requestMicrophone} />}
        {stage === "direction" && <DirectionScreen key="direction" selected={direction} onChange={setDirection} onNext={() => setStage("calibrate")} />}
        {stage === "calibrate" && <CalibrationScreen key={`look-${lookIndex}`} direction={direction} index={lookIndex} feedback={feedback} onFeedback={recordFeedback} onBack={() => lookIndex ? setLookIndex((value) => value - 1) : setStage("direction")} />}
        {stage === "preferences" && <PreferenceScreen key="preferences" moreOf={moreOf} lessOf={lessOf} freeform={freeform} onMore={setMoreOf} onLess={setLessOf} onFreeform={setFreeform} onBack={() => { setLookIndex(looks.length - 1); setStage("calibrate"); }} onNext={() => setStage("profile")} />}
        {stage === "profile" && <Profile key="profile" direction={direction} feedback={feedback} moreOf={moreOf} lessOf={lessOf} freeform={freeform} onBack={() => setStage("preferences")} onEdit={() => { setLookIndex(0); setStage("calibrate"); }} onUndo={undoFeedback} onNext={() => setStage("setup")} />}
        {stage === "setup" && <WardrobeSetup key="setup" onBack={() => setStage("profile")} onExample={() => void finish("demo")} onPersonal={() => void finish("personal")} />}
      </AnimatePresence>
    </main>
  );
}

function Screen({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();
  const isPresent = useIsPresent();
  return <motion.section className={`page-column onboarding-screen ${className}`} aria-hidden={!isPresent} inert={!isPresent ? true : undefined} style={{ pointerEvents: isPresent ? "auto" : "none" }} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 14, scale: 0.995 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10, scale: 0.998 }} transition={reduceMotion ? { duration: 0.12 } : calmSpring}>{children}</motion.section>;
}

function Narrative({ show, children, className = "", delay = 0 }: { show: boolean; children: React.ReactNode; className?: string; delay?: number }) {
  const reduceMotion = useReducedMotion();
  return <AnimatePresence>{show && <motion.div className={className} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0.1 : 0.32, delay }}>{children}</motion.div>}</AnimatePresence>;
}

function Splash({ onNext }: { onNext: () => void }) {
  const delays = useMemo(() => [280, 840, 2250], []);
  const step = useNarrativeSteps(delays);
  return <Screen className="splash-screen"><div className="center-stage splash-stage"><div><Narrative show={step >= 1}><h1 className="page-title">{copy.splash.title}</h1></Narrative><Narrative show={step >= 2}><div className="body-copy splash-subtitle"><span>{copy.splash.subtitleStart}</span><YiYiMark size={34} /><span>{copy.splash.subtitleEnd}</span></div></Narrative></div></div><Narrative show={step >= 3} className="bottom-bar"><PrimaryButton onClick={onNext}>Begin</PrimaryButton></Narrative></Screen>;
}

function Teaching({ onNext }: { onNext: () => void }) {
  const delays = useMemo(() => [180, 620, 1250, 1980, 2660], []);
  const step = useNarrativeSteps(delays);
  return <Screen><header className="onboarding-heading"><Narrative show={step >= 1}><h1>{copy.tutorial.title}</h1></Narrative><Narrative show={step >= 2}><p>{copy.tutorial.subtitle}</p></Narrative></header><div className="teaching-sequence"><Narrative show={step >= 2} className="example-card bad"><span className="check-badge"><X size={15} /></span><div><div className="body-copy">{copy.tutorial.wrong}</div>{step >= 3 && <strong>{copy.tutorial.wrongLabel}</strong>}</div></Narrative><Narrative show={step >= 4} className="example-card good"><span className="check-badge"><Check size={15} /></span><div><div className="body-copy">{copy.tutorial.right}</div>{step >= 5 && <strong>{copy.tutorial.rightLabel}</strong>}</div></Narrative></div><Narrative show={step >= 5} className="bottom-bar"><PrimaryButton onClick={onNext}>{copy.tutorial.showMe}</PrimaryButton></Narrative></Screen>;
}

function UnderstandingDemo({ onNext }: { onNext: () => void }) {
  const delays = useMemo(() => [160, 540, 1050, 1540, 2020, 2500, 3000], []);
  const step = useNarrativeSteps(delays);
  const segments = ["I have class,", "then dinner with friends.", "I’ll be walking a lot,", "and I want something relaxed", "but still photo-ready."];
  const tags = ["Class", "Dinner with friends", "Lots of walking", "Relaxed", "Photo-ready"];
  return <Screen><div className="topbar"><span /><div className="topbar-title">How YiYi listens</div><span /></div><div className="center-stage understanding-demo"><div><VoiceCore state={step < 6 ? "listening" : "thinking"} label="Understanding example" /><p className="voice-state-title">{step < 6 ? "Listening…" : "Understanding…"}</p><div className="semantic-transcript">{segments.map((segment, index) => <motion.span key={segment} className={step >= index + 2 ? "visible" : ""}>{segment} </motion.span>)}</div><div className="chip-row demo-tags">{tags.map((tag, index) => <AnimatePresence key={tag}>{step >= index + 2 && <motion.span className="chip" initial={{ opacity: 0, scale: .86 }} animate={{ opacity: 1, scale: 1 }} transition={calmSpring}>{tag}</motion.span>}</AnimatePresence>)}</div></div></div><Narrative show={step >= 7} className="bottom-bar"><PrimaryButton onClick={onNext}>Continue</PrimaryButton></Narrative></Screen>;
}

function RecommendationDemo({ onNext }: { onNext: () => void }) {
  const delays = useMemo(() => [220, 620, 1040, 1460, 1900, 2440, 3050, 3640, 4200, 4860], []);
  const step = useNarrativeSteps(delays);
  const visibleSlots = (["outerwear", "top", "bottom", "bag", "shoes"] as const).slice(0, Math.max(0, step - 1));
  const revised = step >= 9;
  return <Screen className="recommendation-demo-screen"><header className="recommendation-demo-heading"><Narrative show={step >= 1}><div className="chip-row"><span className="chip">Gallery</span><span className="chip">Dinner</span><span className={`chip demo-changing-tag ${revised ? "revised" : ""}`}>{revised ? "Relaxed" : "Polished"}</span></div></Narrative><Narrative show={step >= 6}><h1>I’d wear this one.</h1><p>Clean tailoring that moves from gallery to dinner.</p></Narrative></header><div className="demo-outfit-stage"><OutfitCanvas outfit={revised ? recommendationAfter : recommendationBefore} wardrobe={demoWardrobe} visibleSlots={visibleSlots} /></div><Narrative show={step >= 7} className="transcript-bubble demo-revision-voice">“Make it a little less formal.”</Narrative><Narrative show={step >= 8} className="demo-causal-note">Polished <span>→</span> Relaxed</Narrative><Narrative show={step >= 10} className="bottom-bar"><PrimaryButton onClick={onNext}>{copy.tutorial.tryIt}</PrimaryButton></Narrative></Screen>;
}

function Permission({ denied, onAllow }: { denied: boolean; onAllow: () => void }) {
  const delays = useMemo(() => [180, 520, 980], []);
  const step = useNarrativeSteps(delays);
  return <Screen><div className="center-stage"><div><Narrative show={step >= 1}><span className="permission-icon"><Mic size={28} /></span></Narrative><Narrative show={step >= 2}><h1 className="page-title">{denied ? "Microphone access is off" : copy.permission.title}</h1><p className="body-copy permission-copy">{denied ? copy.permission.denied : copy.permission.body}</p></Narrative></div></div><Narrative show={step >= 3} className="permission-actions"><PrimaryButton onClick={onAllow}>{denied ? "Try Microphone Again" : copy.permission.allow}</PrimaryButton>{denied && <SecondaryButton onClick={() => window.open("app-settings:")}>{copy.permission.settings}</SecondaryButton>}</Narrative></Screen>;
}

function DirectionScreen({ selected, onChange, onNext }: { selected: WardrobeDirection; onChange: (value: WardrobeDirection) => void; onNext: () => void }) {
  return <Screen><header className="onboarding-heading"><h1>What should YiYi style from?</h1><p>This is about your wardrobe direction, not your identity. You can change it anytime.</p></header><div className="direction-list">{directions.map((direction) => <button key={direction.id} className={`direction-option ${selected === direction.id ? "selected" : ""}`} onClick={() => onChange(direction.id)}><span><strong>{direction.title}</strong><small>{direction.body}</small></span><i>{selected === direction.id && <Check size={16} />}</i></button>)}</div><div className="bottom-bar"><PrimaryButton onClick={onNext}>Continue</PrimaryButton></div></Screen>;
}

function CalibrationScreen({ direction, index, feedback, onFeedback, onBack }: { direction: WardrobeDirection; index: number; feedback: StyleFeedback[]; onFeedback: (value: Sentiment) => void; onBack: () => void }) {
  const current = feedback.find((value) => value.lookId === `look-${index + 1}`)?.sentiment;
  return <Screen className="calibration-screen"><div className="topbar"><button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft /></button><div className="topbar-title">Your taste</div><span className="calibration-progress">{index + 1} / {looks.length}</span></div><header className="calibration-heading"><h1>How does this feel?</h1><p>There is no required number of likes or dislikes.</p></header><motion.div className="calibration-look" key={index} style={lookPosition(index, direction)} initial={{ opacity: 0, scale: .975 }} animate={{ opacity: 1, scale: 1 }} transition={calmSpring}>{current && <span className="calibration-current">{current === "like" ? "Liked" : current === "dislike" ? "Less like me" : "Skipped"}</span>}</motion.div><div className="calibration-actions"><SecondaryButton onClick={() => onFeedback("dislike")}><ThumbsDown size={17} /> Not for me</SecondaryButton><PrimaryButton onClick={() => onFeedback("like")}><Heart size={17} /> More like this</PrimaryButton><button className="skip-button" onClick={() => onFeedback("skip")}>Skip this look</button></div></Screen>;
}

function toggle(values: string[], value: string) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

function PreferenceScreen({ moreOf, lessOf, freeform, onMore, onLess, onFreeform, onBack, onNext }: { moreOf: string[]; lessOf: string[]; freeform: string; onMore: (value: string[]) => void; onLess: (value: string[]) => void; onFreeform: (value: string) => void; onBack: () => void; onNext: () => void }) {
  const voice = usePreferenceVoice(onFreeform);
  return <Screen className="preference-onboarding"><div className="topbar"><button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft /></button><div className="topbar-title">Fine-tune YiYi</div><span /></div><div className="preference-scroll"><section><h1>More of</h1><p>What would you enjoy seeing more often?</p><div className="chip-row preference-chips">{moreOptions.map((value) => <button className={`chip ${moreOf.includes(value) ? "selected" : ""}`} key={value} onClick={() => onMore(toggle(moreOf, value))}>{value}</button>)}</div></section><section><h1>Less of</h1><p>What should YiYi reduce or avoid?</p><div className="chip-row preference-chips">{lessOptions.map((value) => <button className={`chip ${lessOf.includes(value) ? "selected" : ""}`} key={value} onClick={() => onLess(toggle(lessOf, value))}>{value}</button>)}</div></section>{freeform && <div className="spoken-preference">“{freeform}”</div>}</div><div className="preference-voice-area"><button className="preference-mic" data-state={voice.state} onClick={() => void voice.start()} aria-label={voice.state === "error" ? "Retry voice preference" : "Tell YiYi another preference"}><Mic size={22} /></button><span>{voice.state === "listening" ? "Listening…" : voice.state === "understanding" ? "Understanding…" : voice.state === "done" ? "Added to your profile" : voice.state === "error" ? "Voice didn’t start. Tap to retry." : "Tell YiYi something else"}</span></div><div className="bottom-bar"><PrimaryButton onClick={onNext}>Review my style</PrimaryButton></div></Screen>;
}

function Profile({ direction, feedback, moreOf, lessOf, freeform, onBack, onEdit, onUndo, onNext }: { direction: WardrobeDirection; feedback: StyleFeedback[]; moreOf: string[]; lessOf: string[]; freeform: string; onBack: () => void; onEdit: () => void; onUndo: () => void; onNext: () => void }) {
  const liked = feedback.filter((value) => value.sentiment === "like").length;
  const disliked = feedback.filter((value) => value.sentiment === "dislike").length;
  const directionLabel = directions.find((value) => value.id === direction)?.title ?? "No preference";
  return <Screen className="profile-review"><div className="topbar"><button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft /></button><YiYiMark size={37} /><button className="profile-edit" onClick={onEdit}>Edit</button></div><header><h1>{copy.calibration.profile}</h1><p>Everything here stays editable.</p></header><div className="profile-summary"><section><span>Wardrobe direction</span><strong>{directionLabel}</strong></section><section><span>Taste signals</span><strong>{liked} liked · {disliked} less like me</strong></section><section><span>More of</span><strong>{moreOf.join(", ") || "Open to suggestions"}</strong></section><section><span>Less of</span><strong>{lessOf.join(", ") || "Nothing yet"}</strong></section>{freeform && <section><span>In your words</span><strong>“{freeform}”</strong></section>}</div><div className="profile-review-actions">{feedback.length > 0 && <button className="undo-profile" onClick={onUndo}><RotateCcw size={15} /> Undo last style answer</button>}<PrimaryButton onClick={onNext}>Looks right</PrimaryButton><SecondaryButton onClick={onBack}>Back and adjust</SecondaryButton></div></Screen>;
}

function WardrobeSetup({ onBack, onExample, onPersonal }: { onBack: () => void; onExample: () => void; onPersonal: () => void }) {
  return <Screen><div className="topbar"><button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft /></button><span /><span /></div><div className="center-stage"><div><YiYiMark size={78} /><h1 className="page-title setup-title">Make it yours.</h1><p className="body-copy setup-copy">Try YiYi instantly, or add a few tops, bottoms, shoes, and accessories from your own wardrobe.</p></div></div><div className="setup-actions"><PrimaryButton onClick={onExample}>Try the example wardrobe</PrimaryButton><SecondaryButton onClick={onPersonal}>Add my clothes</SecondaryButton></div></Screen>;
}
