"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronLeft, Trash2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { copy } from "@/content/copy";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { lessPreferenceOptions, morePreferenceOptions, preferenceDeltaForOption, type ExplicitPreferenceOption } from "@/domain/preferences/explicit-options";
import { activeLongTermPreferenceSignals, applyPreferenceDelta, removePreferenceSignal } from "@/domain/preferences/profile-mutations";
import { PreferenceDeltaSchema, PreferenceProfileSchema, type PreferenceProfile, type PreferenceSignal, type WardrobeDirection } from "@/domain/schemas";
import { db, getExperienceMode, seedPreferences } from "@/lib/storage/db";
import { demoPreferenceProfile } from "@/mocks/wardrobe";

type SectionId = "direction" | "more" | "less" | "review";

const directionLabels: Record<WardrobeDirection, string> = {
  womenswear: "Womenswear",
  menswear: "Menswear",
  mixed: "Mix both",
  neutral: "No wardrobe label",
};

function canonicalSignals(profile: PreferenceProfile) {
  const durable = activeLongTermPreferenceSignals(profile);
  const review = (profile.preferenceSignals ?? []).filter((signal) => signal.status === "needs_review");
  return [...new Map([...durable, ...review].map((signal) => [signal.id, signal])).values()];
}

function legacyLabels(profile: PreferenceProfile, polarity: "more" | "less") {
  if (profile.preferenceSignals !== undefined) return [];
  if (polarity === "more") {
    return [
      ...profile.softPreferences.filter((rule) => rule.polarity !== "avoid" && !rule.key.endsWith("note")).map((rule) => rule.value),
      ...profile.preferredMetals.map((metal) => `Usually prefer ${metal}-tone jewelry`),
    ];
  }
  return [...profile.hardAvoids, ...profile.softPreferences.filter((rule) => rule.polarity === "avoid")].map((rule) => rule.value);
}

function reviewDelta(label: string, polarity: "more" | "less") {
  return PreferenceDeltaSchema.parse({
    action: "add",
    signalId: null,
    attribute: "preference_note",
    value: label.trim().toLowerCase(),
    label: label.trim(),
    polarity,
    strength: "soft",
    scope: "global_style",
    categories: [],
    slots: [],
    combinationValues: [],
    confidence: 0.5,
    needsReview: true,
    evidenceSummary: `Manual note: ${label.trim()}`,
  });
}

export default function PreferencesPage() {
  const profile = useLiveQuery(() => db.preferenceProfiles.get("default"));
  const [editing, setEditing] = useState<SectionId | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    void getExperienceMode().then((mode) => seedPreferences(mode === "demo" ? demoPreferenceProfile : createNeutralPreferenceProfile()));
  }, []);

  if (!profile) return <main className="phone-page"><div className="page-column"><div className="center-stage"><p className="secondary-copy">Loading preferences…</p></div></div></main>;
  const currentProfile = profile;
  const signals = canonicalSignals(currentProfile);
  const moreSignals = signals.filter((signal) => signal.polarity === "more" && signal.status === "active");
  const lessSignals = signals.filter((signal) => signal.polarity === "less" && signal.status === "active");
  const reviewSignals = signals.filter((signal) => signal.status === "needs_review");
  const legacyMore = legacyLabels(currentProfile, "more");
  const legacyLess = legacyLabels(currentProfile, "less");

  async function mutateProfile(mutation: (latest: PreferenceProfile) => PreferenceProfile) {
    await db.transaction("rw", db.preferenceProfiles, async () => {
      const latest = (await db.preferenceProfiles.get("default")) ?? createNeutralPreferenceProfile();
      const next = mutation(latest);
      await db.preferenceProfiles.put(PreferenceProfileSchema.parse({ ...next, provenance: "personal", updatedAt: Date.now() }));
    });
  }

  async function addOption(option: ExplicitPreferenceOption) {
    await mutateProfile((latest) => applyPreferenceDelta({ profile: latest, delta: preferenceDeltaForOption(option.id), source: "profile_edit" }));
  }

  async function addForReview() {
    const value = draft.trim();
    if (!value || (editing !== "more" && editing !== "less")) return;
    await mutateProfile((latest) => applyPreferenceDelta({ profile: latest, delta: reviewDelta(value, editing), source: "profile_edit" }));
    setDraft("");
    setEditing(null);
  }

  async function removeSignal(signalId: string) {
    await mutateProfile((latest) => removePreferenceSignal({ profile: latest, signalId, source: "profile_edit" }));
  }

  async function updateDirection(wardrobeDirection: WardrobeDirection) {
    await mutateProfile((latest) => ({ ...(latest.provenance === "demo" ? createNeutralPreferenceProfile() : latest), wardrobeDirection }));
    setEditing(null);
  }

  async function resetPreferences() {
    await db.preferenceProfiles.put(createNeutralPreferenceProfile(Date.now()));
    setConfirmReset(false);
  }

  return <main className="phone-page"><div className="page-column">
    <header className="topbar"><Link href="/today" className="icon-button" aria-label="Back"><ChevronLeft /></Link><YiYiMark size={37} /><span /></header>
    <h1 className="memory-title">What YiYi remembers</h1>
    {currentProfile.provenance === "demo" && <p className="preference-demo-note">Example preferences for the demo wardrobe. They are removed when you add your own clothes.</p>}
    <div className="memory-scroll">
      <section className="memory-section" role="region" aria-label="Wardrobe description">
        <div className="memory-section-heading"><h2>Wardrobe description</h2><button className="chip" onClick={() => setEditing("direction")}>Edit</button></div>
        <p className="secondary-copy">{directionLabels[currentProfile.wardrobeDirection]}</p>
      </section>
      <SignalSection title="More of" signals={moreSignals} legacyLabels={legacyMore} onEdit={() => setEditing("more")} onRemove={removeSignal} empty="Nothing preferred yet" />
      <SignalSection title="Less of" signals={lessSignals} legacyLabels={legacyLess} onEdit={() => setEditing("less")} onRemove={removeSignal} empty="Nothing reduced yet" />
      {reviewSignals.length > 0 && <motion.div layout initial={false} animate={{ opacity: 1 }}><SignalSection title="Needs review" signals={reviewSignals} legacyLabels={[]} onEdit={() => setEditing("review")} onRemove={removeSignal} empty="Nothing waiting for review" /></motion.div>}
      <section className="memory-explanation"><h2>Clear evidence only</h2><p className="secondary-copy">More and Less affect recommendations. Unclear language stays editable under Needs review until you replace it with a precise preference.</p></section>
    </div>
    <AnimatePresence initial={false} mode="popLayout">{confirmReset ? <motion.div className="reset-confirm" key="confirm" initial={{ opacity: 0, transform: "translateY(4px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} exit={{ opacity: 0 }} transition={{ duration: .18 }}><p>{copy.preferences.resetConfirm}</p><div><SecondaryButton onClick={() => setConfirmReset(false)}>Cancel</SecondaryButton><PrimaryButton onClick={() => void resetPreferences()}>Reset</PrimaryButton></div></motion.div> : <motion.button key="reset" className="secondary-button danger-button memory-reset" onClick={() => setConfirmReset(true)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .14 }}>Reset preferences</motion.button>}</AnimatePresence>
    <BottomSheet open={Boolean(editing)} onClose={() => setEditing(null)} label="Edit saved preferences" className="preference-sheet">
      {editing === "direction" && <DirectionMemory value={currentProfile.wardrobeDirection} onChange={(value) => void updateDirection(value)} />}
      {(editing === "more" || editing === "less") && <PreferenceEditor
        title={editing === "more" ? "Edit More of" : "Edit Less of"}
        options={editing === "more" ? morePreferenceOptions : lessPreferenceOptions}
        activeSignals={editing === "more" ? moreSignals : lessSignals}
        draft={draft}
        onDraft={setDraft}
        onAddOption={(option) => void addOption(option)}
        onAddReview={() => void addForReview()}
        onClose={() => setEditing(null)}
      />}
      {editing === "review" && <ReviewEditor signals={reviewSignals} onRemove={(id) => void removeSignal(id)} onClose={() => setEditing(null)} />}
    </BottomSheet>
  </div></main>;
}

function SignalSection({ title, signals, legacyLabels: legacy, onEdit, onRemove, empty }: { title: string; signals: PreferenceSignal[]; legacyLabels: string[]; onEdit: () => void; onRemove: (signalId: string) => Promise<void>; empty: string }) {
  return <section className="memory-section" role="region" aria-label={title}>
    <div className="memory-section-heading"><h2>{title}</h2><button className="chip" onClick={onEdit}>Edit</button></div>
    <motion.div className="chip-row memory-chips" layout><AnimatePresence initial={false}>
      {signals.map((signal) => <MemorySignalChip signal={signal} onRemove={onRemove} key={signal.id} />)}
      {legacy.map((label) => <motion.span layout className="chip" key={label}>{label}</motion.span>)}
      {!signals.length && !legacy.length && <motion.span className="secondary-copy" key="empty" initial={false} animate={{ opacity: 1 }}>{empty}</motion.span>}
    </AnimatePresence></motion.div>
  </section>;
}

function MemorySignalChip({ signal, onRemove }: { signal: PreferenceSignal; onRemove: (signalId: string) => Promise<void> }) {
  const reduceMotion = useReducedMotionConfig();
  return <motion.span
    className="chip memory-signal-chip"
    layout
    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "scale(.98)" }}
    animate={{ opacity: 1, transform: "scale(1)" }}
    transition={{ duration: reduceMotion ? .1 : .16, ease: [.23, 1, .32, 1] }}
  >{signal.label}{signal.status === "needs_review" && <small>Review</small>}<button aria-label={`Delete ${signal.label}`} onClick={() => void onRemove(signal.id)}><Trash2 size={13} /></button></motion.span>;
}

function DirectionMemory({ value, onChange }: { value: WardrobeDirection; onChange: (value: WardrobeDirection) => void }) {
  return <><h2>Edit wardrobe description</h2><p className="secondary-copy">This is a descriptive label, not a hidden ranking rule. YiYi uses the clothes you add and preferences you state.</p>{(Object.keys(directionLabels) as WardrobeDirection[]).map((direction) => <button className="attribute-row" aria-pressed={value === direction} key={direction} onClick={() => onChange(direction)}><span>{directionLabels[direction]}</span>{value === direction && <Check size={16} />}</button>)}</>;
}

function PreferenceEditor({ title, options, activeSignals, draft, onDraft, onAddOption, onAddReview, onClose }: { title: string; options: ExplicitPreferenceOption[]; activeSignals: PreferenceSignal[]; draft: string; onDraft: (value: string) => void; onAddOption: (option: ExplicitPreferenceOption) => void; onAddReview: () => void; onClose: () => void }) {
  const activeLabels = new Set(activeSignals.map((signal) => signal.label));
  return <><div className="preference-sheet-title"><h2>{title}</h2><button className="icon-button" aria-label="Done editing" onClick={onClose}><X size={18} /></button></div>
    <p className="secondary-copy">Choose a precise preference so YiYi can use it immediately.</p>
    <div className="chip-row preference-chips">{options.map((option) => <button className={`chip ${activeLabels.has(option.label) ? "selected" : ""}`} disabled={activeLabels.has(option.label)} key={option.id} onClick={() => onAddOption(option)}>{option.label}</button>)}</div>
    <label className="secondary-copy" htmlFor="preference-review-note">Something more specific?</label>
    <input id="preference-review-note" className="sheet-input" maxLength={80} value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="Describe it for review" aria-label="New saved preference" />
    <p className="secondary-copy">Unstructured notes stay under Needs review and do not affect recommendations yet.</p>
    <PrimaryButton disabled={!draft.trim()} onClick={onAddReview}>Add for review</PrimaryButton>
  </>;
}

function ReviewEditor({ signals, onRemove, onClose }: { signals: PreferenceSignal[]; onRemove: (signalId: string) => void; onClose: () => void }) {
  return <><div className="preference-sheet-title"><h2>Needs review</h2><button className="icon-button" aria-label="Done editing" onClick={onClose}><X size={18} /></button></div><p className="secondary-copy">These notes are visible but do not affect recommendations.</p><div className="saved-memory-list">{signals.map((signal) => <div key={signal.id}><span>{signal.label}</span><button aria-label={`Delete ${signal.label}`} onClick={() => onRemove(signal.id)}><Trash2 size={16} /></button></div>)}</div></>;
}
