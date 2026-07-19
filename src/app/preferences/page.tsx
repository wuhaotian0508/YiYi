"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronLeft, Trash2, X } from "lucide-react";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { PreferenceProfileSchema, type PreferenceProfile, type WardrobeDirection } from "@/domain/schemas";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { db, getExperienceMode, seedPreferences } from "@/lib/storage/db";
import { demoPreferenceProfile } from "@/mocks/wardrobe";
import { copy } from "@/content/copy";

type SectionId = "direction" | "style" | "avoids" | "comfort" | "jewelry" | "words";
const directionLabels: Record<WardrobeDirection, string> = { womenswear: "Womenswear", menswear: "Menswear", mixed: "Mix both", neutral: "No preference" };

export default function PreferencesPage() {
  const profile = useLiveQuery(() => db.preferenceProfiles.get("default"));
  const [editing, setEditing] = useState<SectionId | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    void getExperienceMode().then((mode) => seedPreferences(mode === "personal" ? createNeutralPreferenceProfile() : demoPreferenceProfile));
  }, []);
  if (!profile) return <main className="phone-page"><div className="page-column"><div className="center-stage"><p className="secondary-copy">Loading preferences…</p></div></div></main>;
  const currentProfile = profile;

  async function save(next: PreferenceProfile) {
    await db.preferenceProfiles.put(PreferenceProfileSchema.parse({ ...next, provenance: "personal", updatedAt: Date.now() }));
  }

  async function addMemory() {
    const value = draft.trim();
    if (!value || !editing) return;
    if (editing === "avoids") await save({ ...currentProfile, softPreferences: [...currentProfile.softPreferences, { key: "manual-note", value, strength: "soft", polarity: "avoid" }] });
    if (editing === "style" || editing === "comfort") await save({ ...currentProfile, softPreferences: [...currentProfile.softPreferences, { key: editing, value, strength: "soft" }] });
    if (editing === "jewelry" && ["gold", "silver", "mixed"].includes(value.toLowerCase())) await save({ ...currentProfile, preferredMetals: [...new Set([...currentProfile.preferredMetals, value.toLowerCase() as "gold" | "silver" | "mixed"])] });
    if (editing === "words") await save({ ...currentProfile, preferenceNotes: { ...currentProfile.preferenceNotes, freeform: value } });
    setDraft("");
  }

  async function removeMemory(section: SectionId, value: string) {
    if (section === "avoids") await save({ ...currentProfile, hardAvoids: currentProfile.hardAvoids.filter((rule) => rule.value !== value), softPreferences: currentProfile.softPreferences.filter((rule) => !(rule.polarity === "avoid" && rule.value === value)) });
    if (section === "style" || section === "comfort") await save({ ...currentProfile, softPreferences: currentProfile.softPreferences.filter((rule) => rule.value !== value) });
    if (section === "jewelry") await save({ ...currentProfile, preferredMetals: currentProfile.preferredMetals.filter((metal) => metal !== value) });
    if (section === "words") await save({ ...currentProfile, preferenceNotes: { ...currentProfile.preferenceNotes, freeform: "" } });
  }

  async function resetPreferences() {
    const mode = await getExperienceMode();
    const baseline = mode === "personal" ? createNeutralPreferenceProfile() : demoPreferenceProfile;
    await db.preferenceProfiles.put({ ...baseline, updatedAt: Date.now() });
    setConfirmReset(false);
  }

  const styleValues = currentProfile.softPreferences.filter((rule) => rule.key !== "comfort" && rule.polarity !== "avoid").map((rule) => rule.value);
  const comfortValues = currentProfile.softPreferences.filter((rule) => rule.key === "comfort").map((rule) => rule.value);
  const avoidValues = [...currentProfile.hardAvoids, ...currentProfile.softPreferences.filter((rule) => rule.polarity === "avoid")].map((rule) => rule.value);
  const sections: { id: SectionId; title: string; values: string[]; chips?: boolean }[] = [
    { id: "direction", title: "Wardrobe direction", values: [directionLabels[currentProfile.wardrobeDirection]] },
    { id: "style", title: "Your style", values: styleValues.length ? styleValues : ["No saved style direction yet"] },
    { id: "avoids", title: "Usually avoid", values: avoidValues, chips: true },
    { id: "comfort", title: "Comfort", values: comfortValues.length ? comfortValues : ["No saved comfort rules yet"] },
    { id: "jewelry", title: "Jewelry preference", values: currentProfile.preferredMetals.map((metal) => `Usually prefer ${metal}-tone jewelry`) },
    { id: "words", title: "In your words", values: currentProfile.preferenceNotes.freeform ? [currentProfile.preferenceNotes.freeform] : ["No spoken preference saved yet"] },
  ];

  return <main className="phone-page"><div className="page-column"><header className="topbar"><Link href="/today" className="icon-button" aria-label="Back"><ChevronLeft /></Link><YiYiMark size={37} /><span /></header><h1 className="memory-title">What YiYi remembers</h1><div className="memory-scroll">{sections.map((section) => <section className="memory-section" key={section.id}><div className="memory-section-heading"><h2>{section.title}</h2><button className="chip" onClick={() => { setEditing(section.id); setDraft(""); }}>Edit</button></div>{section.chips ? <div className="chip-row memory-chips">{section.values.map((value) => <span className="chip" key={value}>{value}</span>)}</div> : section.values.map((value) => <p className="secondary-copy" key={value}>{value}</p>)}</section>)}<section className="memory-explanation"><h2>YiYi only saves preferences</h2><p className="secondary-copy">you state clearly or repeat over time.</p></section></div>{confirmReset ? <div className="reset-confirm"><p>{copy.preferences.resetConfirm}</p><div><SecondaryButton onClick={() => setConfirmReset(false)}>Cancel</SecondaryButton><PrimaryButton onClick={() => void resetPreferences()}>Reset</PrimaryButton></div></div> : <button className="secondary-button danger-button memory-reset" onClick={() => setConfirmReset(true)}>Reset preferences</button>}<BottomSheet open={Boolean(editing)} onClose={() => setEditing(null)} label="Edit saved preferences" className="preference-sheet">{editing === "direction" ? <DirectionMemory value={currentProfile.wardrobeDirection} onChange={(wardrobeDirection) => { void save({ ...currentProfile, wardrobeDirection }); setEditing(null); }} /> : editing && <PreferenceSheet section={editing} values={sections.find((section) => section.id === editing)?.values ?? []} draft={draft} onDraft={setDraft} onAdd={() => void addMemory()} onRemove={(value) => void removeMemory(editing, value)} onClose={() => setEditing(null)} />}</BottomSheet></div></main>;
}

function DirectionMemory({ value, onChange }: { value: WardrobeDirection; onChange: (value: WardrobeDirection) => void }) {
  return <><h2>Edit wardrobe direction</h2><p className="secondary-copy">This guides styling without making assumptions about identity.</p>{(Object.keys(directionLabels) as WardrobeDirection[]).map((direction) => <button className="attribute-row" key={direction} onClick={() => onChange(direction)}><span>{directionLabels[direction]}</span>{value === direction && <Check size={16} />}</button>)}</>;
}

function PreferenceSheet({ section, values, draft, onDraft, onAdd, onRemove, onClose }: { section: SectionId; values: string[]; draft: string; onDraft: (value: string) => void; onAdd: () => void; onRemove: (value: string) => void; onClose: () => void }) {
  const placeholder = section === "jewelry" ? "gold, silver, or mixed" : section === "avoids" ? "Something you usually avoid" : section === "words" ? "Describe what you want YiYi to understand" : "A preference YiYi should remember";
  return <><div className="preference-sheet-title"><h2>Edit memory</h2><button className="icon-button" aria-label="Done editing" onClick={onClose}><X size={18} /></button></div><div className="saved-memory-list">{values.filter((value) => !value.startsWith("No saved")).map((value) => <div key={value}><span><Check size={14} />{value}</span><button aria-label={`Delete ${value}`} onClick={() => onRemove(section === "jewelry" ? (["gold", "silver", "mixed"].find((metal) => value.toLowerCase().includes(metal)) ?? value) : value)}><Trash2 size={16} /></button></div>)}</div><input className="sheet-input" value={draft} onChange={(event) => onDraft(event.target.value)} placeholder={placeholder} aria-label="New saved preference" /><PrimaryButton disabled={!draft.trim()} onClick={onAdd}>Add memory</PrimaryButton></>;
}
