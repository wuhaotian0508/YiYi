"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft } from "lucide-react";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { db, requestPersistentStorage } from "@/lib/storage/db";

export default function SettingsPage() {
  const router = useRouter();
  const [storage, setStorage] = useState("Checking…");
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    void requestPersistentStorage().then(({ usage, persisted }) => {
      const megabytes = usage / (1024 * 1024);
      setStorage(`${megabytes < .1 ? "< 0.1" : megabytes.toFixed(1)} MB · ${persisted ? "protected" : "device managed"}`);
    });
  }, []);

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
  return <main className="phone-page"><div className="page-column"><header className="topbar"><Link className="icon-button" href="/today" aria-label="Back"><ChevronLeft /></Link><div className="topbar-title">Settings</div><span /></header><h1 className="page-title" style={{ fontSize: 27, margin: "30px 0" }}>Settings</h1><div>{sections.map(([label, value]) => <div className="attribute-row" key={label}><span>{label}</span><span className="settings-value">{value}{label === "Storage" && <Check size={14} />}</span></div>)}</div><div className="settings-privacy"><h2>Stored on this device</h2><p className="secondary-copy">Wardrobe images, outfit history, and preferences stay in this browser. Processing sends only the selected item.</p></div>{confirmReset ? <div className="reset-confirm"><p>Remove the local wardrobe, preferences, and outfit history?</p><div><SecondaryButton onClick={() => setConfirmReset(false)}>Cancel</SecondaryButton><PrimaryButton onClick={() => void resetDemo()}>Reset</PrimaryButton></div></div> : <button className="secondary-button danger-button" style={{ marginTop: "auto" }} onClick={() => setConfirmReset(true)}>Reset local demo</button>}<p className="secondary-copy" style={{ textAlign: "center" }}>YiYi 0.1.0</p></div></main>;
}
