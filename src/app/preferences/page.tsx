"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronLeft, Trash2, X } from "lucide-react";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { PreferenceProfileSchema, type PreferenceProfile } from "@/domain/schemas";
import { db, seedPreferences } from "@/lib/storage/db";
import { demoPreferenceProfile } from "@/mocks/wardrobe";

type SectionId = "style" | "avoids" | "comfort" | "jewelry";

export default function PreferencesPage() {
  const profile = useLiveQuery(() => db.preferenceProfiles.get("default"));
  const [editing, setEditing] = useState<SectionId | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { void seedPreferences(demoPreferenceProfile); }, []);
  if (!profile) return <main className="phone-page"><div className="page-column"><div className="center-stage"><p className="secondary-copy">Loading preferences…</p></div></div></main>;
  const currentProfile = profile;

  async function save(next: PreferenceProfile) {
    await db.preferenceProfiles.put(PreferenceProfileSchema.parse({ ...next, updatedAt: Date.now() }));
  }

  async function addMemory() {
    const value = draft.trim();
    if (!value || !editing) return;
    if (editing === "avoids") await save({ ...currentProfile, hardAvoids: [...currentProfile.hardAvoids, { key: "manual", value, strength: "hard" }] });
    if (editing === "style" || editing === "comfort") await save({ ...currentProfile, softPreferences: [...currentProfile.softPreferences, { key: editing, value, strength: "soft" }] });
    if (editing === "jewelry" && ["gold", "silver", "mixed"].includes(value.toLowerCase())) await save({ ...currentProfile, preferredMetals: [...new Set([...currentProfile.preferredMetals, value.toLowerCase() as "gold" | "silver" | "mixed"])] });
    setDraft("");
  }

  async function removeMemory(section: SectionId, value: string) {
    if (section === "avoids") await save({ ...currentProfile, hardAvoids: currentProfile.hardAvoids.filter((rule) => rule.value !== value) });
    if (section === "style" || section === "comfort") await save({ ...currentProfile, softPreferences: currentProfile.softPreferences.filter((rule) => rule.value !== value) });
    if (section === "jewelry") await save({ ...currentProfile, preferredMetals: currentProfile.preferredMetals.filter((metal) => metal !== value) });
  }

  async function resetPreferences() {
    await db.preferenceProfiles.put({ ...demoPreferenceProfile, updatedAt: Date.now() });
    setConfirmReset(false);
  }

  const styleValues = currentProfile.softPreferences.filter((rule) => rule.key !== "comfort").map((rule) => rule.value);
  const comfortValues = currentProfile.softPreferences.filter((rule) => rule.key === "comfort").map((rule) => rule.value);
  const sections: { id: SectionId; title: string; values: string[]; chips?: boolean }[] = [
    { id: "style", title: "Your style", values: styleValues.length ? styleValues : ["No saved style direction yet"] },
    { id: "avoids", title: "Usually avoid", values: currentProfile.hardAvoids.map((rule) => rule.value), chips: true },
    { id: "comfort", title: "Comfort", values: comfortValues.length ? comfortValues : ["No saved comfort rules yet"] },
    { id: "jewelry", title: "Jewelry preference", values: currentProfile.preferredMetals.map((metal) => `Usually prefer ${metal}-tone jewelry`) },
  ];

  return <main className="phone-page"><div className="page-column"><header className="topbar"><Link href="/today" className="icon-button" aria-label="Back"><ChevronLeft /></Link><YiYiMark size={37} /><span /></header><h1 className="memory-title">What YiYi remembers</h1>{sections.map((section) => <section className="memory-section" key={section.id}><div className="memory-section-heading"><h2>{section.title}</h2><button className="chip" onClick={() => { setEditing(section.id); setDraft(""); }}>Edit</button></div>{section.chips ? <div className="chip-row memory-chips">{section.values.map((value) => <span className="chip" key={value}>{value}</span>)}</div> : section.values.map((value) => <p className="secondary-copy" key={value}>{value}</p>)}</section>)}<section style={{ padding: "18px 0" }}><h2 style={{ fontSize: 14 }}>YiYi only saves preferences</h2><p className="secondary-copy">you state clearly or repeat over time.</p></section>{confirmReset ? <div className="reset-confirm"><p>Reset all saved preferences to the demo defaults?</p><div><SecondaryButton onClick={() => setConfirmReset(false)}>Cancel</SecondaryButton><PrimaryButton onClick={() => void resetPreferences()}>Reset</PrimaryButton></div></div> : <button className="secondary-button danger-button" style={{ marginTop: "auto" }} onClick={() => setConfirmReset(true)}>Reset preferences</button>}{editing && <PreferenceSheet section={editing} values={sections.find((section) => section.id === editing)?.values ?? []} draft={draft} onDraft={setDraft} onAdd={() => void addMemory()} onRemove={(value) => void removeMemory(editing, value)} onClose={() => setEditing(null)} />}</div></main>;
}

function PreferenceSheet({ section, values, draft, onDraft, onAdd, onRemove, onClose }: { section: SectionId; values: string[]; draft: string; onDraft: (value: string) => void; onAdd: () => void; onRemove: (value: string) => void; onClose: () => void }) {
  const placeholder = section === "jewelry" ? "gold, silver, or mixed" : section === "avoids" ? "Something you usually avoid" : "A preference YiYi should remember";
  return <><button className="sheet-scrim" aria-label="Close preference editor" onClick={onClose} /><section className="bottom-sheet preference-sheet" aria-label="Edit saved preferences"><div className="sheet-handle" /><div className="preference-sheet-title"><h2>Edit memory</h2><button className="icon-button" aria-label="Done editing" onClick={onClose}><X size={18} /></button></div><div className="saved-memory-list">{values.filter((value) => !value.startsWith("No saved")).map((value) => <div key={value}><span><Check size={14} />{value}</span><button aria-label={`Delete ${value}`} onClick={() => onRemove(section === "jewelry" ? (["gold", "silver", "mixed"].find((metal) => value.toLowerCase().includes(metal)) ?? value) : value)}><Trash2 size={16} /></button></div>)}</div><input className="sheet-input" value={draft} onChange={(event) => onDraft(event.target.value)} placeholder={placeholder} aria-label="New saved preference" /><PrimaryButton disabled={!draft.trim()} onClick={onAdd}>Add memory</PrimaryButton></section></>;
}
