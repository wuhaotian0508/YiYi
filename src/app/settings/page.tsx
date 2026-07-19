"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Volume2 } from "lucide-react";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { configureSounds, playSound, unlockSounds } from "@/lib/audio/sound-system";
import { db, getSoundEnabled, requestPersistentStorage, setSoundEnabled } from "@/lib/storage/db";

export default function SettingsPage() {
  const router = useRouter();
  const [storage, setStorage] = useState("Checking…");
  const [confirmReset, setConfirmReset] = useState(false);
  const [sounds, setSounds] = useState(true);
  useEffect(() => {
    void requestPersistentStorage().then(({ usage, persisted }) => {
      const megabytes = usage / (1024 * 1024);
      setStorage(`${megabytes < .1 ? "< 0.1" : megabytes.toFixed(1)} MB · ${persisted ? "protected" : "device managed"}`);
    });
    void getSoundEnabled().then((value) => { setSounds(value); configureSounds(value); });
  }, []);

  async function toggleSounds() {
    const next = !sounds;
    await unlockSounds();
    setSounds(next);
    configureSounds(next);
    await setSoundEnabled(next);
    if (next) playSound("understood");
  }

  async function resetDemo() {
    await db.delete();
    localStorage.removeItem("yiyi:onboarding-complete");
    router.replace("/");
  }

  const sections = [
    ["Voice", process.env.NEXT_PUBLIC_VOICE_MODE === "live" ? "Marin · Live" : "Marin · Demo"],
    ["Weather", "Demo weather"],
    ["Storage", storage],
    ["Privacy", "Images are sent only when processing"],
  ];
  return <main className="phone-page"><div className="page-column settings-page"><header className="topbar"><Link className="icon-button" href="/today" aria-label="Back"><ChevronLeft /></Link><div className="topbar-title">Settings</div><span /></header><h1>Settings</h1><section className="settings-group"><button className="settings-toggle-row" role="switch" aria-checked={sounds} onClick={() => void toggleSounds()}><span><Volume2 size={18} /><span><strong>Interface sounds</strong><small>Only key voice and outfit moments</small></span></span><i className={sounds ? "on" : ""} aria-hidden="true"><b /></i></button><Link className="attribute-row" href="/preferences"><span>What YiYi remembers</span><span className="settings-value">Edit</span></Link>{sections.map(([label, value]) => <div className="attribute-row" key={label}><span>{label}</span><span className="settings-value">{value}{label === "Storage" && <Check size={14} />}</span></div>)}</section><div className="settings-privacy"><h2>Stored on this device</h2><p className="secondary-copy">Wardrobe images, outfit history, and preferences stay in this browser. Processing sends only the selected item.</p></div>{confirmReset ? <div className="reset-confirm"><p>Remove the local wardrobe, preferences, and outfit history?</p><div><SecondaryButton onClick={() => setConfirmReset(false)}>Cancel</SecondaryButton><PrimaryButton onClick={() => void resetDemo()}>Reset</PrimaryButton></div></div> : <button className="secondary-button danger-button" style={{ marginTop: "auto" }} onClick={() => setConfirmReset(true)}>Reset local demo</button>}<p className="secondary-copy settings-version">YiYi 0.1.0</p></div></main>;
}
