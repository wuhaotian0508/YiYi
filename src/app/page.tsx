"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Check, Mic, X } from "lucide-react";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { VoiceCore } from "@/components/voice/voice-core";
import { copy } from "@/content/copy";
import { requestPersistentStorage, seedPreferences, seedWardrobe } from "@/lib/storage/db";
import { demoPreferenceProfile, demoWardrobe } from "@/mocks/wardrobe";

type Stage = "splash" | "teach" | "understand" | "recommend" | "permission" | "denied" | "likes" | "least" | "avoids" | "profile" | "setup";
const avoids = ["Heels", "Tight fits", "Cropped tops", "Short skirts", "Bright colors", "Formal looks", "Gold-tone jewelry", "Silver-tone jewelry"];
const looks = [0, 1, 2, 3, 4, 5];

function lookPosition(index: number) {
  return { "--look-x": `${(index % 3) * 50}%`, "--look-y": `${Math.floor(index / 3) * 100}%` } as React.CSSProperties;
}

export default function FirstRunPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("splash");
  const [liked, setLiked] = useState<number[]>([]);
  const [least, setLeast] = useState<number | null>(null);
  const [selectedAvoids, setSelectedAvoids] = useState<string[]>(["Heels", "Formal looks"]);

  useEffect(() => {
    if (localStorage.getItem("yiyi:onboarding-complete") === "true") router.replace("/today");
    const timer = window.setTimeout(() => setStage("teach"), 1450);
    return () => window.clearTimeout(timer);
  }, [router]);

  async function requestMicrophone() {
    if (process.env.NEXT_PUBLIC_VOICE_MODE === "mock") { setStage("likes"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setStage("likes");
    } catch { setStage("denied"); }
  }

  async function finishWithExampleWardrobe() {
    await seedWardrobe(demoWardrobe);
    await seedPreferences({
      ...demoPreferenceProfile,
      hardAvoids: selectedAvoids.map((value) => ({ key: "onboarding", value: value.toLowerCase(), strength: "hard" as const })),
      updatedAt: Date.now(),
    });
    await requestPersistentStorage();
    localStorage.setItem("yiyi:onboarding-complete", "true");
    router.push("/today");
  }

  return (
    <main className="phone-page">
      <AnimatePresence mode="wait">
        {stage === "splash" && <Splash key="splash" />}
        {stage === "teach" && <Teaching key="teach" onNext={() => setStage("understand")} />}
        {stage === "understand" && <UnderstandingDemo key="understand" onNext={() => setStage("recommend")} />}
        {stage === "recommend" && <RecommendationDemo key="recommend" onNext={() => setStage("permission")} />}
        {(stage === "permission" || stage === "denied") && <Permission key={stage} denied={stage === "denied"} onAllow={requestMicrophone} />}
        {stage === "likes" && <StyleLikes key="likes" selected={liked} onChange={setLiked} onNext={() => setStage("least")} />}
        {stage === "least" && <StyleLeast key="least" selected={least} onChange={setLeast} onNext={() => setStage("avoids")} />}
        {stage === "avoids" && <Avoids key="avoids" selected={selectedAvoids} onChange={setSelectedAvoids} onNext={() => setStage("profile")} />}
        {stage === "profile" && <Profile key="profile" avoids={selectedAvoids} onNext={() => setStage("setup")} />}
        {stage === "setup" && <WardrobeSetup key="setup" onExample={finishWithExampleWardrobe} onPersonal={() => { void seedPreferences(demoPreferenceProfile); localStorage.setItem("yiyi:onboarding-complete", "true"); router.push("/wardrobe/add"); }} />}
      </AnimatePresence>
    </main>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <motion.section className="page-column" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .24 }}>{children}</motion.section>;
}

function Splash() {
  return <Screen><div className="center-stage"><div><motion.h1 className="page-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .5 }}>{copy.splash.title}</motion.h1><motion.div className="body-copy" style={{ marginTop: 22, display: "flex", gap: 7, alignItems: "center", justifyContent: "center" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .45, duration: .45 }}><span>{copy.splash.subtitleStart}</span><YiYiMark size={34} /><span>{copy.splash.subtitleEnd}</span></motion.div></div></div></Screen>;
}

function Teaching({ onNext }: { onNext: () => void }) {
  return <Screen><div style={{ paddingTop: 54, textAlign: "center" }}><div className="page-title" style={{ fontSize: 26 }}>{copy.tutorial.title}</div><p className="secondary-copy">{copy.tutorial.subtitle}</p></div><div style={{ display: "grid", gap: 12, marginTop: 42 }}><div className="example-card bad"><span className="check-badge"><X size={15} /></span><div><div className="body-copy">{copy.tutorial.wrong}</div><strong style={{ fontSize: 13 }}>{copy.tutorial.wrongLabel}</strong></div></div><div className="example-card good"><span className="check-badge"><Check size={15} /></span><div><div className="body-copy">{copy.tutorial.right}</div><strong style={{ fontSize: 13, color: "#218349" }}>{copy.tutorial.rightLabel}</strong></div></div></div><div className="bottom-bar"><PrimaryButton onClick={onNext}>{copy.tutorial.showMe}</PrimaryButton></div></Screen>;
}

function UnderstandingDemo({ onNext }: { onNext: () => void }) {
  return <Screen><div className="topbar"><span /><div className="topbar-title">How YiYi listens</div><span /></div><div className="center-stage" style={{ alignContent: "center" }}><div><div className="transcript-bubble" style={{ margin: "0 auto 30px", textAlign: "left" }}>“I have class, then dinner with friends. I’ll be walking a lot, and I want something relaxed but still photo-ready.”</div><VoiceCore active /><p className="secondary-copy">Understanding…</p><div className="chip-row" style={{ marginTop: 25 }}>{["Class", "Dinner with friends", "Lots of walking", "Relaxed", "Photo-ready"].map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div></div></div><div className="bottom-bar"><PrimaryButton onClick={onNext}>Continue</PrimaryButton></div></Screen>;
}

function RecommendationDemo({ onNext }: { onNext: () => void }) {
  return <Screen><div style={{ textAlign: "center", paddingTop: 28 }}><h2 className="page-title" style={{ fontSize: 25 }}>I’d wear this one.</h2><p className="secondary-copy">Relaxed, comfortable,<br />and still intentional.</p></div><div className="center-stage"><div className="soft-card" style={{ width: "100%", height: 320, display: "grid", placeItems: "center" }}><div style={{ display: "flex", alignItems: "end", gap: 17 }}><span className="garment outerwear" style={{ "--garment": "#765c47" } as React.CSSProperties} /><span className="garment top" style={{ "--garment": "#eee9df" } as React.CSSProperties} /><span className="garment bottom" style={{ "--garment": "#607b96" } as React.CSSProperties} /><span className="garment bag" style={{ "--garment": "#805537" } as React.CSSProperties} /></div></div></div><div className="transcript-bubble" style={{ marginBottom: 12 }}>“Make it a little less formal.”</div><div className="bottom-bar"><PrimaryButton onClick={onNext}>{copy.tutorial.tryIt}</PrimaryButton></div></Screen>;
}

function Permission({ denied, onAllow }: { denied: boolean; onAllow: () => void }) {
  return <Screen><div className="center-stage"><div><span style={{ width: 76, height: 76, borderRadius: "50%", background: "#f4f4f6", display: "grid", placeItems: "center", margin: "0 auto 28px" }}><Mic size={28} /></span><h1 className="page-title" style={{ fontSize: 26 }}>{denied ? "Microphone access is off" : copy.permission.title}</h1><p className="body-copy" style={{ maxWidth: 330, margin: "16px auto" }}>{denied ? copy.permission.denied : copy.permission.body}</p></div></div><div style={{ display: "grid", gap: 10 }}><PrimaryButton onClick={onAllow}>{copy.permission.allow}</PrimaryButton>{denied && <SecondaryButton onClick={() => window.open("app-settings:")}>{copy.permission.settings}</SecondaryButton>}</div></Screen>;
}

function StyleLikes({ selected, onChange, onNext }: { selected: number[]; onChange: (v: number[]) => void; onNext: () => void }) {
  const toggle = (index: number) => onChange(selected.includes(index) ? selected.filter((value) => value !== index) : selected.length < 3 ? [...selected, index] : selected);
  return <Screen><div style={{ textAlign: "center", padding: "22px 8px" }}><h1 className="page-title" style={{ fontSize: 25 }}>{copy.calibration.likes}</h1><p className="secondary-copy">{copy.calibration.likesHint}</p></div><div className="style-grid">{looks.map((look, index) => <button aria-label={`Style look ${index + 1}`} key={look} className={`style-card ${selected.includes(index) ? "selected" : ""}`} style={lookPosition(index)} onClick={() => toggle(index)}>{selected.includes(index) && <span className="style-index"><Check size={15} /></span>}</button>)}</div><div className="bottom-bar" style={{ display: "block" }}><p className="secondary-copy" style={{ textAlign: "center" }}>{selected.length} of 3 selected</p><PrimaryButton disabled={selected.length !== 3} onClick={onNext}>Continue</PrimaryButton></div></Screen>;
}

function StyleLeast({ selected, onChange, onNext }: { selected: number | null; onChange: (v: number) => void; onNext: () => void }) {
  return <Screen><div style={{ textAlign: "center", padding: "22px 8px" }}><h1 className="page-title" style={{ fontSize: 25 }}>{copy.calibration.least}</h1><p className="secondary-copy">Select one.</p></div><div className="style-grid">{looks.slice(0, 4).map((look, index) => <button aria-label={`Least-like style ${index + 1}`} key={look} className={`style-card ${selected === index ? "selected" : ""}`} style={lookPosition(index)} onClick={() => onChange(index)}>{selected === index && <span className="style-index"><Check size={15} /></span>}</button>)}</div><div className="bottom-bar"><PrimaryButton disabled={selected === null} onClick={onNext}>Continue</PrimaryButton></div></Screen>;
}

function Avoids({ selected, onChange, onNext }: { selected: string[]; onChange: (v: string[]) => void; onNext: () => void }) {
  return <Screen><div style={{ textAlign: "center", padding: "32px 8px 22px" }}><h1 className="page-title" style={{ fontSize: 25 }}>{copy.calibration.avoid}</h1></div><div className="chip-row" style={{ alignContent: "start" }}>{avoids.map((value) => <button key={value} className={`chip ${selected.includes(value) ? "selected" : ""}`} onClick={() => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])}>{value}</button>)}</div><div className="soft-card" style={{ marginTop: 28, display: "flex", alignItems: "center", justifyContent: "space-between" }}><span>Tell YiYi something else</span><Mic size={18} /></div><div className="bottom-bar"><PrimaryButton onClick={onNext}>Continue</PrimaryButton></div></Screen>;
}

function Profile({ avoids, onNext }: { avoids: string[]; onNext: () => void }) {
  return <Screen><div style={{ paddingTop: 52 }}><div style={{ display: "flex", justifyContent: "center", marginBottom: 30 }}><YiYiMark size={74} /></div><h1 className="page-title" style={{ fontSize: 27 }}>{copy.calibration.profile}</h1><div className="soft-card body-copy" style={{ marginTop: 22, lineHeight: 1.75 }}>Relaxed, clean, slightly cool-toned<br />Comfort over formality<br /><span style={{ color: "#666" }}>Avoids {avoids.slice(0, 2).join(" and ").toLowerCase()}</span></div></div><div className="bottom-bar"><PrimaryButton onClick={onNext}>Looks right</PrimaryButton></div></Screen>;
}

function WardrobeSetup({ onExample, onPersonal }: { onExample: () => void; onPersonal: () => void }) {
  return <Screen><div className="center-stage"><div><YiYiMark size={78} /><h1 className="page-title" style={{ marginTop: 28 }}>Make it yours.</h1><p className="body-copy" style={{ maxWidth: 320 }}>Try YiYi instantly, or add a few tops, bottoms, shoes, and accessories from your own wardrobe.</p></div></div><div style={{ display: "grid", gap: 10 }}><PrimaryButton onClick={onExample}>Try the example wardrobe</PrimaryButton><SecondaryButton onClick={onPersonal}>Add my clothes</SecondaryButton></div></Screen>;
}
