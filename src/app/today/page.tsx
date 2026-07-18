"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, MicOff, Shirt, SlidersHorizontal, Undo2, Volume2, XCircle } from "lucide-react";
import { VoiceCore, VoiceStatusMark, type VoiceVisualState } from "@/components/voice/voice-core";
import { OutfitCarousel } from "@/components/outfit/outfit-carousel";
import { OutfitCanvas } from "@/components/outfit/outfit-canvas";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { copy } from "@/content/copy";
import { changedAndPreserved, generateCandidates, reviseOverall, reviseTargeted, type RevisionTarget } from "@/domain/recommendation/engine";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { OutfitVersionSchema, WeatherContextSchema, type DailyIntent, type Outfit, type PreferenceProfile, type WardrobeItem, type WeatherContext } from "@/domain/schemas";
import { rankOutfits } from "@/lib/recommendation/client-ranking";
import { MockVoiceSessionAdapter, OpenAIRealtimeVoiceAdapter, resolveAvailabilityItemId, type TranscriptState, type VoiceSessionAdapter, type VoiceState, type VoiceToolHandlers } from "@/lib/realtime/voice-session";
import { db, getExperienceMode, seedPreferences, seedWardrobe } from "@/lib/storage/db";
import { calmSpring } from "@/lib/motion/tokens";
import { demoIntent, demoPreferenceProfile, demoWardrobe } from "@/mocks/wardrobe";

type Phase = "idle" | "connecting" | "listening" | "understanding" | "generating" | "presenting" | "revising" | "confirmed" | "error";
type OutfitSlot = keyof Outfit["itemIds"];
type IntentTag = { id: string; kind: "activity" | "aesthetic" | "excluded"; index: number; label: string };

function localDateKey() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function intentTags(intent: DailyIntent): IntentTag[] {
  return [
    ...intent.activities.map((activity, index) => ({ id: `activity-${index}`, kind: "activity" as const, index, label: activity.label })),
    ...intent.aestheticTerms.map((term, index) => ({ id: `aesthetic-${index}`, kind: "aesthetic" as const, index, label: term.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()) })),
    ...intent.excludedCategories.map((category, index) => ({ id: `excluded-${index}`, kind: "excluded" as const, index, label: category === "one_piece" ? "No dresses" : `No ${category.replaceAll("_", " ")}` })),
  ];
}

function preferenceSummary(profile: PreferenceProfile | undefined) {
  if (!profile) return "No saved long-term preferences.";
  const avoids = profile.hardAvoids.map((rule) => rule.value).join(", ");
  const prefers = profile.softPreferences.map((rule) => rule.value).join(", ");
  return `Prefers ${prefers || "balanced looks"}. Avoids ${avoids || "nothing explicit"}.`;
}

function targetToSlot(target: string, focused: OutfitSlot | null): Exclude<RevisionTarget, "overall"> | null {
  const slots: Record<string, Exclude<RevisionTarget, "overall">> = {
    top: "top", bottom: "bottom", one_piece: "onePiece", outerwear: "outerwear", shoes: "shoes", bag: "bag", jewelry: "jewelry",
    headwear: "extraAccessory", scarf: "extraAccessory", belt: "extraAccessory", eyewear: "extraAccessory", hair_accessory: "extraAccessory", other_accessory: "extraAccessory",
  };
  return slots[target] ?? focused;
}

export default function TodayPage() {
  const initialCandidates = useMemo(() => generateCandidates(demoWardrobe, demoIntent), []);
  const [phase, setPhase] = useState<Phase>("idle");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [hydrated, setHydrated] = useState(false);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [intent, setIntent] = useState<DailyIntent>(demoIntent);
  const [ranked, setRanked] = useState<Outfit[]>(initialCandidates.slice(0, 3));
  const [current, setCurrent] = useState<Outfit | null>(initialCandidates[0] ?? null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [reason, setReason] = useState<string>(copy.outfit.reason);
  const [history, setHistory] = useState<Outfit[]>([]);
  const [focusedSlot, setFocusedSlot] = useState<OutfitSlot | null>(null);
  const [transcript, setTranscript] = useState("Gallery this afternoon, dinner tonight, lots of walking, and no dresses.");
  const [muted, setMuted] = useState(false);
  const [editingTag, setEditingTag] = useState<IntentTag | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [weather, setWeather] = useState<WeatherContext | null>(null);
  const adapterRef = useRef<VoiceSessionAdapter | null>(null);
  const unsubscribeRef = useRef<(() => void)[]>([]);
  const rankAbortRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const versionIdRef = useRef<string | null>(null);
  const lastPersistedOutfitRef = useRef<Outfit | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);
  const lifetimeTimerRef = useRef<number | null>(null);
  const currentRef = useRef(current);
  const wardrobeRef = useRef(wardrobe);
  const intentRef = useRef(intent);
  const rankedRef = useRef(ranked);
  const focusedSlotRef = useRef(focusedSlot);
  const selectedIndexRef = useRef(selectedIndex);
  const weatherRef = useRef(weather);
  currentRef.current = current;
  wardrobeRef.current = wardrobe;
  intentRef.current = intent;
  rankedRef.current = ranked;
  focusedSlotRef.current = focusedSlot;
  selectedIndexRef.current = selectedIndex;
  weatherRef.current = weather;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await seedWardrobe(demoWardrobe);
      const experienceMode = await getExperienceMode();
      await seedPreferences(experienceMode === "personal" ? createNeutralPreferenceProfile() : demoPreferenceProfile);
      const weatherResponse = await fetch("/api/weather", { cache: "no-store" }).catch(() => null);
      if (weatherResponse?.ok) {
        const payload: unknown = await weatherResponse.json();
        const parsedWeather = WeatherContextSchema.safeParse(typeof payload === "object" && payload ? (payload as { weather?: unknown }).weather : null);
        if (parsedWeather.success) { setWeather(parsedWeather.data); weatherRef.current = parsedWeather.data; }
      }
      const items = await db.wardrobeItems.toArray();
      const sessions = await db.dailySessions.where("dateKey").equals(localDateKey()).toArray();
      const session = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (cancelled) return;
      setWardrobe(items);
      wardrobeRef.current = items;
      setHydrated(true);
      if (session?.status === "confirmed" && session.currentVersionId) {
        const version = await db.outfitVersions.get(session.currentVersionId);
        if (!cancelled && version) {
          sessionIdRef.current = session.id;
          versionIdRef.current = version.id;
          lastPersistedOutfitRef.current = version.outfit;
          setIntent(session.intent);
          setRanked([version.outfit]);
          setCurrent(version.outfit);
          setPhase("confirmed");
        }
      }
    })();
    const onVisibility = () => {
      if (!document.hidden) return;
      unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
      unsubscribeRef.current = [];
      void adapterRef.current?.disconnect();
      adapterRef.current = null;
      setPhase("idle");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      rankAbortRef.current?.abort();
      unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
      unsubscribeRef.current = [];
      void adapterRef.current?.disconnect();
      adapterRef.current = null;
    };
  }, []);

  function clearSessionTimers() {
    if (inactivityTimerRef.current) window.clearTimeout(inactivityTimerRef.current);
    if (lifetimeTimerRef.current) window.clearTimeout(lifetimeTimerRef.current);
    inactivityTimerRef.current = null;
    lifetimeTimerRef.current = null;
  }

  function resetInactivityTimer() {
    if (inactivityTimerRef.current) window.clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = window.setTimeout(() => void disconnectVoice("idle"), 90_000);
  }

  async function disconnectVoice(nextPhase?: Phase) {
    clearSessionTimers();
    unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRef.current = [];
    const adapter = adapterRef.current;
    adapterRef.current = null;
    if (adapter) await adapter.disconnect();
    setVoiceState("idle");
    if (nextPhase) setPhase(nextPhase);
  }

  async function persistVersion(outfit: Outfit, revisionRequest: string | null, previous: Outfit | null = lastPersistedOutfitRef.current) {
    const now = Date.now();
    const sessionId = sessionIdRef.current ?? crypto.randomUUID();
    sessionIdRef.current = sessionId;
    const changes = previous && previous.id !== outfit.id
      ? changedAndPreserved(previous, outfit)
      : { changedItemIds: [], preservedItemIds: Object.values(outfit.itemIds).filter((id): id is string => Boolean(id)) };
    const version = OutfitVersionSchema.parse({
      id: crypto.randomUUID(), sessionId, parentVersionId: versionIdRef.current, outfit, revisionRequest,
      changedItemIds: changes.changedItemIds, preservedItemIds: changes.preservedItemIds, createdAt: now,
    });
    await db.transaction("rw", db.outfitVersions, db.dailySessions, async () => {
      await db.outfitVersions.put(version);
      await db.dailySessions.put({
        id: sessionId, dateKey: localDateKey(), status: "active", intent: intentRef.current, weather: weatherRef.current,
        currentVersionId: version.id, mainRecommendationId: rankedRef.current[0]?.id ?? outfit.id,
        alternativeIds: rankedRef.current.slice(1, 3).map((candidate) => candidate.id), createdAt: now, updatedAt: now, confirmedAt: null,
      });
    });
    versionIdRef.current = version.id;
    lastPersistedOutfitRef.current = outfit;
  }

  async function runRecommendation(nextIntent: DailyIntent, utterance: string) {
    const sequence = ++requestSequenceRef.current;
    rankAbortRef.current?.abort();
    const controller = new AbortController();
    rankAbortRef.current = controller;
    setIntent(nextIntent);
    intentRef.current = nextIntent;
    setPhase("understanding");
    const items = await db.wardrobeItems.toArray();
    const availableWardrobe = items.length ? items : wardrobeRef.current;
    setWardrobe(availableWardrobe);
    wardrobeRef.current = availableWardrobe;
    const candidates = generateCandidates(availableWardrobe, nextIntent, 8, { weather: weatherRef.current });
    if (candidates.length < 3) {
      setPhase("error");
      return { success: false as const, summary: "There are not enough available pieces for three complete outfits." };
    }
    const profile = await db.preferenceProfiles.get("default");
    setPhase("generating");
    const result = await rankOutfits({
      candidates, wardrobe: availableWardrobe, intent: nextIntent, originalUtterance: utterance,
      preferenceSummary: preferenceSummary(profile), weather: weatherRef.current, signal: controller.signal,
    });
    if (sequence !== requestSequenceRef.current) return { success: false as const, summary: "A newer outfit request replaced this one." };
    setRanked(result.outfits);
    rankedRef.current = result.outfits;
    setSelectedIndex(0);
    selectedIndexRef.current = 0;
    setCurrent(result.outfits[0]);
    currentRef.current = result.outfits[0];
    setReason(result.mainReason);
    setHistory([]);
    setPhase("presenting");
    await persistVersion(result.outfits[0], null, null);
    return { success: true as const, summary: "I found one clear choice and two alternatives." };
  }

  async function revise(slot: OutfitSlot = "bag", request = "The bag feels too formal.") {
    const before = currentRef.current;
    if (!before) return { success: false as const, summary: "There is no current outfit to revise." };
    setPhase("revising");
    setHistory((values) => [...values, before]);
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    const next = reviseTargeted(before, slot, wardrobeRef.current, intentRef.current, request);
    if (next.id === before.id) {
      setPhase("presenting");
      return { success: false as const, summary: `I could not find another ${slot}.` };
    }
    const nextRanked = rankedRef.current.map((candidate, index) => index === selectedIndexRef.current ? next : candidate);
    setRanked(nextRanked);
    rankedRef.current = nextRanked;
    setCurrent(next);
    currentRef.current = next;
    setReason(copy.outfit.revised);
    setFocusedSlot(null);
    setPhase("presenting");
    await persistVersion(next, request, before);
    return { success: true as const, summary: "Better. I kept everything else." };
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return false;
    const nextRanked = rankedRef.current.map((candidate, index) => index === selectedIndexRef.current ? previous : candidate);
    setRanked(nextRanked);
    rankedRef.current = nextRanked;
    setCurrent(previous);
    currentRef.current = previous;
    setHistory((values) => values.slice(0, -1));
    setReason(copy.outfit.reason);
    return true;
  }

  async function confirmCurrent() {
    const outfit = currentRef.current;
    if (!outfit) return { success: false as const, summary: "There is no outfit to confirm." };
    if (!versionIdRef.current || lastPersistedOutfitRef.current?.id !== outfit.id) await persistVersion(outfit, "Selected an alternative");
    const now = Date.now();
    const sessionId = sessionIdRef.current!;
    await db.transaction("rw", db.dailySessions, db.wardrobeItems, async () => {
      const existing = await db.dailySessions.get(sessionId);
      await db.dailySessions.put({
        id: sessionId,
        dateKey: localDateKey(),
        status: "confirmed",
        intent: intentRef.current,
        weather: weatherRef.current,
        currentVersionId: versionIdRef.current,
        mainRecommendationId: rankedRef.current[0]?.id ?? outfit.id,
        alternativeIds: rankedRef.current.slice(1, 3).map((candidate) => candidate.id),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        confirmedAt: now,
      });
      const wornIds = Object.values(outfit.itemIds).filter((id): id is string => Boolean(id));
      await db.wardrobeItems.where("id").anyOf(wornIds).modify({ lastWornAt: now, updatedAt: now });
    });
    await disconnectVoice();
    setPhase("confirmed");
    return { success: true as const, summary: "Outfit decided." };
  }

  function createHandlers(): VoiceToolHandlers {
    return {
      requestRecommendation: async (nextIntent) => {
        return runRecommendation(nextIntent, nextIntent.freeformSummary);
      },
      revise: async (input) => {
        if (input.action === "undo") return { success: undo(), summary: "I went back to the previous outfit." };
        if (input.target === "overall") {
          const before = currentRef.current;
          if (!before) return { success: false, summary: "There is no current outfit to revise." };
          const next = reviseOverall(before, wardrobeRef.current, intentRef.current, input.revision);
          if (next.id === before.id) return { success: false, summary: "I could not improve that direction without changing too much." };
          setHistory((values) => [...values, before]);
          setCurrent(next);
          currentRef.current = next;
          const nextRanked = rankedRef.current.map((candidate, index) => index === selectedIndexRef.current ? next : candidate);
          setRanked(nextRanked);
          rankedRef.current = nextRanked;
          setReason("This feels fresher while keeping the outfit recognizable.");
          setPhase("presenting");
          await persistVersion(next, input.revision, before);
          return { success: true, summary: "This feels fresher while keeping the outfit recognizable." };
        }
        const slot = targetToSlot(input.target, focusedSlotRef.current);
        if (!slot) return { success: false, summary: "Tap the item you want to change." };
        return revise(slot, input.revision);
      },
      confirm: async () => confirmCurrent(),
      setAvailability: async (input) => {
        const focusedItemId = focusedSlotRef.current ? currentRef.current?.itemIds[focusedSlotRef.current] ?? null : null;
        const itemId = resolveAvailabilityItemId(input.itemId, focusedItemId);
        if (!itemId) return { success: false, summary: "Tap the item you mean, then tell me its availability again." };
        const updated = await db.wardrobeItems.update(itemId, { availability: input.availability, unavailableReason: input.reason ?? undefined, updatedAt: Date.now() });
        if (!updated) return { success: false, summary: "I could not find that wardrobe item." };
        const items = await db.wardrobeItems.toArray();
        setWardrobe(items);
        wardrobeRef.current = items;
        if (currentRef.current && Object.values(currentRef.current.itemIds).includes(itemId)) await runRecommendation(intentRef.current, intentRef.current.freeformSummary);
        return { success: true, summary: "I updated that item and kept the outfit valid." };
      },
      savePreference: async (input) => {
        const profile = (await db.preferenceProfiles.get("default")) ?? demoPreferenceProfile;
        const rule = { key: "voice", value: input.rule, strength: input.polarity === "avoid" ? "hard" as const : "soft" as const };
        const updated: PreferenceProfile = {
          ...profile,
          hardAvoids: input.polarity === "avoid" ? [...profile.hardAvoids.filter((value) => value.value !== input.rule), rule] : profile.hardAvoids,
          softPreferences: input.polarity === "prefer" ? [...profile.softPreferences.filter((value) => value.value !== input.rule), rule] : profile.softPreferences,
          evidence: [...profile.evidence, { phrase: input.evidencePhrase, source: "explicit_voice" as const, createdAt: Date.now() }].slice(-100),
          updatedAt: Date.now(),
        };
        await db.preferenceProfiles.put(updated);
        return { success: true, summary: "I’ll remember that preference." };
      },
    };
  }

  async function startSession() {
    if (!hydrated || adapterRef.current) return;
    setPhase("connecting");
    setVoiceState("connecting");
    const adapter = process.env.NEXT_PUBLIC_VOICE_MODE === "live"
      ? new OpenAIRealtimeVoiceAdapter(createHandlers())
      : new MockVoiceSessionAdapter();
    adapterRef.current = adapter;
    const onState = adapter.onState((state) => {
      resetInactivityTimer();
      setVoiceState(state);
      if (state === "connecting") setPhase("connecting");
      if (state === "listening") setPhase((value) => value === "presenting" || value === "revising" ? value : "listening");
      if (state === "thinking") setPhase((value) => value === "presenting" || value === "revising" ? value : "understanding");
      if (state === "speaking" || state === "interrupted") setPhase((value) => value === "presenting" || value === "revising" ? value : "listening");
      if (state === "error") setPhase("error");
    });
    const onTranscript = adapter.onTranscript((nextTranscript: TranscriptState) => {
      resetInactivityTimer();
      setTranscript(nextTranscript.text);
      if (nextTranscript.role === "user" && nextTranscript.final && process.env.NEXT_PUBLIC_VOICE_MODE !== "live") {
        setPhase("understanding");
        window.setTimeout(() => void runRecommendation(demoIntent, nextTranscript.text), 500);
      }
    });
    unsubscribeRef.current = [onState, onTranscript];
    lifetimeTimerRef.current = window.setTimeout(() => void disconnectVoice("idle"), 300_000);
    resetInactivityTimer();
    try { await adapter.connect(); } catch { setPhase("error"); }
  }

  function toggleMute() {
    const next = !muted;
    adapterRef.current?.mute(next);
    setMuted(next);
  }

  function selectOutfit(index: number) {
    const outfit = ranked[index];
    if (!outfit) return;
    setSelectedIndex(index);
    selectedIndexRef.current = index;
    setCurrent(outfit);
    currentRef.current = outfit;
    setReason(index === 0 ? copy.outfit.reason : index === 1 ? "A softer, more relaxed direction." : "A slightly more polished option.");
    setFocusedSlot(null);
  }

  async function applyTagEdit(remove = false) {
    if (!editingTag) return;
    const next: DailyIntent = structuredClone(intentRef.current);
    if (editingTag.kind === "activity") {
      if (remove || !tagDraft.trim()) next.activities.splice(editingTag.index, 1);
      else next.activities[editingTag.index].label = tagDraft.trim();
    } else if (editingTag.kind === "aesthetic") {
      if (remove || !tagDraft.trim()) next.aestheticTerms.splice(editingTag.index, 1);
      else next.aestheticTerms[editingTag.index] = tagDraft.trim().toLowerCase();
    } else if (remove) next.excludedCategories.splice(editingTag.index, 1);
    setEditingTag(null);
    await runRecommendation(next, next.freeformSummary);
  }

  const tags = intentTags(intent);
  return (
    <main className="phone-page today-page">
      <div className="page-column">
        <header className="topbar">
          <Link className="icon-button" href="/wardrobe" aria-label="Open wardrobe"><Shirt size={21} strokeWidth={1.6} /></Link>
          <div className="weather-pill">{weather?.summary ?? "58° · Light rain"}</div>
          <Link className="icon-button" href="/preferences" aria-label="Open preferences"><SlidersHorizontal size={20} strokeWidth={1.6} /></Link>
        </header>

        <AnimatePresence initial={false}>
          {phase === "idle" && <Idle key="idle" onStart={startSession} hydrated={hydrated} />}
          {(phase === "connecting" || phase === "listening" || phase === "understanding" || phase === "generating") && <Listening key="listening" phase={phase} voiceState={voiceState} transcript={transcript} tags={tags} onEditTag={(tag) => { setEditingTag(tag); setTagDraft(tag.label); }} muted={muted} onMute={toggleMute} onEnd={() => void disconnectVoice("idle")} />}
          {(phase === "presenting" || phase === "revising") && current && (
            <Result key="result" wardrobe={wardrobe} ranked={ranked} selectedIndex={selectedIndex} reason={reason} phase={phase} tags={tags}
              focusedSlot={focusedSlot} onFocus={setFocusedSlot} onEditTag={(tag) => { setEditingTag(tag); setTagDraft(tag.label); }}
              voiceState={voiceState} onSelect={selectOutfit} onRevise={revise} onUndo={undo} canUndo={history.length > 0} onConfirm={() => void confirmCurrent()} />
          )}
          {phase === "confirmed" && current && <Confirmed key="confirmed" current={current} wardrobe={wardrobe} onRevise={() => setPhase("presenting")} />}
          {phase === "error" && <ErrorState key="error" onRetry={() => void disconnectVoice("idle")} />}
        </AnimatePresence>
        <BottomSheet open={Boolean(editingTag)} onClose={() => setEditingTag(null)} label="Edit today’s intent">
          {editingTag && <IntentTagSheet tag={editingTag} value={tagDraft} onChange={setTagDraft} onSave={() => void applyTagEdit()} onRemove={() => void applyTagEdit(true)} />}
        </BottomSheet>
      </div>
    </main>
  );
}

function MotionSection({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();
  const isPresent = useIsPresent();
  return <motion.section className={className} aria-hidden={!isPresent} inert={!isPresent ? true : undefined} style={{ flex: 1, minWidth: 0, minHeight: 0, width: "100%", display: "flex", flexDirection: "column", pointerEvents: isPresent ? "auto" : "none" }} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.995 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5, scale: 0.998 }} transition={reduceMotion ? { duration: 0.12 } : calmSpring}>{children}</motion.section>;
}

function Idle({ onStart, hydrated }: { onStart: () => void; hydrated: boolean }) {
  return <MotionSection><div className="center-stage today-idle"><div><VoiceCore state="idle" onClick={onStart} disabled={!hydrated} /><h1>{copy.today.prompt}</h1><p className="secondary-copy">“{copy.today.example}”</p><div className="waveform waveform-idle" /></div></div></MotionSection>;
}

function Listening({ phase, voiceState, transcript, tags, muted, onMute, onEnd, onEditTag }: { phase: "connecting" | "listening" | "understanding" | "generating"; voiceState: VoiceState; transcript: string; tags: IntentTag[]; muted: boolean; onMute: () => void; onEnd: () => void; onEditTag: (tag: IntentTag) => void }) {
  const visualState: VoiceVisualState = phase === "connecting" ? "connecting" : phase === "understanding" || phase === "generating" ? "thinking" : voiceState === "speaking" || voiceState === "interrupted" ? voiceState : "listening";
  const status = phase === "connecting" ? "Starting live voice…" : phase === "generating" ? "Building your outfit…" : visualState === "speaking" ? "Speaking…" : visualState === "interrupted" ? "Listening again…" : phase === "listening" ? copy.today.listening : copy.today.understanding;
  const showTranscript = phase === "listening";
  return <MotionSection><div className="center-stage voice-session-stage"><div><VoiceCore state={visualState} label={status} /><AnimatePresence mode="popLayout"><motion.h1 key={status} className="voice-state-title" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} transition={{ duration: 0.16 }}>{status}</motion.h1></AnimatePresence><AnimatePresence mode="wait" initial={false}>{showTranscript ? <motion.div key="transcript" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><p className="body-copy live-transcript">“{transcript}”</p><div className="waveform waveform-live" /></motion.div> : <motion.div className="chip-row understood-tags" key="tags" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{tags.map((tag) => <button className="chip" key={tag.id} onClick={() => onEditTag(tag)}>{tag.label}</button>)}</motion.div>}</AnimatePresence></div></div><div className="bottom-bar session-controls"><SecondaryButton onClick={onMute}>{muted ? <Volume2 size={16} /> : <MicOff size={16} />} {muted ? "Unmute" : "Mute"}</SecondaryButton><SecondaryButton onClick={onEnd}><XCircle size={16} /> End session</SecondaryButton></div></MotionSection>;
}

function Result({ wardrobe, ranked, selectedIndex, reason, phase, tags, focusedSlot, voiceState, onFocus, onEditTag, onSelect, onRevise, onUndo, canUndo, onConfirm }: {
  wardrobe: WardrobeItem[]; ranked: Outfit[]; selectedIndex: number; reason: string; phase: "presenting" | "revising"; tags: IntentTag[]; focusedSlot: OutfitSlot | null;
  voiceState: VoiceState;
  onFocus: (slot: OutfitSlot) => void; onEditTag: (tag: IntentTag) => void; onSelect: (index: number) => void; onRevise: (slot?: OutfitSlot) => void;
  onUndo: () => void; canUndo: boolean; onConfirm: () => void;
}) {
  const compactVoiceState: VoiceVisualState = voiceState === "speaking" || voiceState === "thinking" || voiceState === "interrupted" || voiceState === "error" ? voiceState : "listening";
  return <MotionSection className="result-section"><div className="result-heading"><AnimatePresence mode="popLayout"><motion.h1 key={selectedIndex} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.18 }}>{selectedIndex === 0 ? copy.outfit.main : selectedIndex === 1 ? "A more relaxed direction." : "A more polished direction."}</motion.h1></AnimatePresence><p className="secondary-copy">{canUndo ? copy.outfit.revised : reason}</p></div><div className="intent-strip">{tags.map((tag) => <button className="chip" key={tag.id} onClick={() => onEditTag(tag)}>{tag.label}</button>)}</div><div className="outfit-stage">{phase === "revising" && <motion.div className="transcript-bubble revision-bubble" initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>“The bag feels too formal.”</motion.div>}<OutfitCarousel outfits={ranked} wardrobe={wardrobe} selectedIndex={selectedIndex} onSelect={onSelect} onSelectItem={onFocus} />{ranked.length > 1 && <><button className="carousel-arrow carousel-arrow-left" aria-label="Previous outfit" disabled={selectedIndex === 0} onClick={() => onSelect(selectedIndex - 1)}><ChevronLeft /></button><button className="carousel-arrow carousel-arrow-right" aria-label="Next outfit" disabled={selectedIndex === ranked.length - 1} onClick={() => onSelect(selectedIndex + 1)}><ChevronRight /></button></>}{phase === "revising" && <motion.div className="revision-thinking" initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }}><VoiceStatusMark state="thinking" label="Revising outfit" /></motion.div>}</div><div className="outfit-direction"><span>More relaxed</span><span aria-label={`Outfit ${selectedIndex + 1} of ${ranked.length}`}>{ranked.map((_, index) => <button key={index} aria-label={`Show outfit ${index + 1}`} onClick={() => onSelect(index)}><span className={index === selectedIndex ? "active" : ""} /></button>)}</span><span>More polished</span></div>{focusedSlot && <motion.div className="soft-card focused-item" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={calmSpring}><span>Change this {focusedSlot === "extraAccessory" ? "accessory" : focusedSlot}?</span><SecondaryButton onClick={() => onRevise(focusedSlot)}>Replace</SecondaryButton></motion.div>}<button className="voice-toolbar" onClick={() => onRevise("bag")}><VoiceStatusMark state={compactVoiceState} label={copy.outfit.listening} /><span className="voice-toolbar-label">{copy.outfit.listening}</span><span className="secondary-copy">Try a bag revision</span></button><div className="bottom-bar result-actions"><SecondaryButton disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /> {copy.outfit.undo}</SecondaryButton><PrimaryButton onClick={onConfirm}>{copy.outfit.wear}</PrimaryButton></div></MotionSection>;
}

function Confirmed({ current, wardrobe, onRevise }: { current: Outfit; wardrobe: WardrobeItem[]; onRevise: () => void }) {
  return <MotionSection><div className="center-stage"><div style={{ width: "100%" }}><VoiceCore active={false} label="Outfit confirmed" /><h1 className="page-title" style={{ fontSize: 27 }}>{copy.outfit.confirmedTitle}</h1><p className="secondary-copy">{copy.outfit.confirmedBody}</p><div className="confirmed-outfit"><OutfitCanvas outfit={current} wardrobe={wardrobe} /></div></div></div><div style={{ display: "grid", gap: 10 }}><PrimaryButton onClick={onRevise}>See today’s outfit</PrimaryButton><Link href="/wardrobe" className="secondary-button">Back to wardrobe</Link></div></MotionSection>;
}

function IntentTagSheet({ tag, value, onChange, onSave, onRemove }: { tag: IntentTag; value: string; onChange: (value: string) => void; onSave: () => void; onRemove: () => void }) {
  return <><h2>Edit today’s intent</h2><p className="secondary-copy">This changes today only and immediately refreshes the outfit.</p>{tag.kind !== "excluded" && <input className="sheet-input" aria-label="Intent tag" value={value} onChange={(event) => onChange(event.target.value)} />}<div className="sheet-actions"><SecondaryButton onClick={onRemove}>{tag.kind === "excluded" ? "Allow this today" : "Remove tag"}</SecondaryButton>{tag.kind !== "excluded" && <PrimaryButton disabled={!value.trim()} onClick={onSave}>Update outfit</PrimaryButton>}</div></>;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <MotionSection><div className="center-stage"><div><VoiceCore active={false} label="Voice unavailable" /><h1 className="page-title" style={{ fontSize: 25 }}>YiYi couldn’t finish that.</h1><p className="secondary-copy">Your wardrobe is safe. Try the live session again.</p></div></div><PrimaryButton onClick={onRetry}>Try again</PrimaryButton></MotionSection>;
}
