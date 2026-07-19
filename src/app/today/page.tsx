"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls, useIsPresent, useReducedMotion } from "motion/react";
import { Check, Settings, Shirt, Shuffle, Undo2 } from "lucide-react";
import { OutfitCanvas } from "@/components/outfit/outfit-canvas";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { VoiceCore, VoiceDock, type VoiceVisualState } from "@/components/voice/voice-core";
import { copy } from "@/content/copy";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { saveUnstructuredVoicePreference, updateProfileFromOutfitFeedback } from "@/domain/preferences/feedback";
import { assertDisplayedOutfitLegal, runRecommendationDecision, validateRestoredOutfit } from "@/domain/recommendation/engine";
import { createRecommendationContext, RecommendationError } from "@/domain/recommendation/context";
import { IntentDeltaSchema, WeatherContextSchema, type DailyIntent, type IntentDelta, type Outfit, type OutfitSlot, type PreferenceProfile, type WardrobeItem, type WeatherContext } from "@/domain/schemas";
import { configureSounds, playSound, unlockSounds } from "@/lib/audio/sound-system";
import { calmSpring } from "@/lib/motion/tokens";
import { MockVoiceSessionAdapter, OpenAIRealtimeVoiceAdapter, resolveAvailabilityItemId, type TranscriptState, type VoiceSessionAdapter, type VoiceState, type VoiceToolHandlers } from "@/lib/realtime/voice-session";
import { rankOutfits } from "@/lib/recommendation/client-ranking";
import { RecommendationOperationController, type OperationToken } from "@/lib/recommendation/operation-controller";
import { commitOutfitMutation, confirmOutfitMutation, resetInvalidOutfitSession, undoOutfitMutation } from "@/lib/recommendation/session-mutations";
import { db, getExperienceMode, getSoundEnabled, seedPreferences, seedWardrobe } from "@/lib/storage/db";
import { demoIntent, demoPreferenceProfile, demoWardrobe } from "@/mocks/wardrobe";

type Phase = "idle" | "connecting" | "listening" | "understanding" | "generating" | "presenting" | "revising" | "paused" | "confirmed" | "error";
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
  const avoids = [...profile.hardAvoids, ...profile.softPreferences.filter((rule) => rule.polarity === "avoid")].map((rule) => rule.value).join(", ");
  const prefers = [...profile.softPreferences.filter((rule) => rule.polarity !== "avoid" && !rule.key.endsWith("note")).map((rule) => rule.value), ...profile.preferenceNotes.moreOf].join(", ");
  return `Wardrobe direction: ${profile.wardrobeDirection}. Prefers ${prefers || "balanced looks"}. Avoids ${avoids || "nothing explicit"}.`;
}

function voiceVisualState(phase: Phase, voiceState: VoiceState): VoiceVisualState {
  if (phase === "connecting") return "connecting";
  if (phase === "understanding" || phase === "generating" || phase === "revising") return "thinking";
  if (voiceState === "speaking" || voiceState === "interrupted" || voiceState === "error") return voiceState;
  return phase === "idle" || phase === "paused" || phase === "confirmed" ? "idle" : "listening";
}

function voiceStatus(phase: Phase, voiceState: VoiceState) {
  if (phase === "connecting") return "Connecting…";
  if (phase === "understanding") return "Understanding…";
  if (phase === "generating") return "Creating one clear answer…";
  if (phase === "revising") return "Revising…";
  if (phase === "paused") return "Session paused · Tap to reconnect";
  if (voiceState === "speaking") return "YiYi is speaking…";
  if (voiceState === "interrupted") return "Interrupted · Listening again…";
  if (phase === "presenting") return "YiYi is listening…";
  if (phase === "confirmed") return "Outfit decided";
  return phase === "idle" ? "Tap to talk" : "Listening…";
}

export default function TodayPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [hydrated, setHydrated] = useState(false);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [intent, setIntent] = useState<DailyIntent>(demoIntent);
  const [current, setCurrent] = useState<Outfit | null>(null);
  const [reason, setReason] = useState<string>(copy.outfit.reason);
  const [history, setHistory] = useState<Outfit[]>([]);
  const [focusedSlot, setFocusedSlot] = useState<OutfitSlot | null>(null);
  const [transcript, setTranscript] = useState("");
  const [muted, setMuted] = useState(false);
  const [editingTag, setEditingTag] = useState<IntentTag | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [weather, setWeather] = useState<WeatherContext | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const adapterRef = useRef<VoiceSessionAdapter | null>(null);
  const unsubscribeRef = useRef<(() => void)[]>([]);
  const operationControllerRef = useRef(new RecommendationOperationController());
  const sessionIdRef = useRef<string | null>(null);
  const versionIdRef = useRef<string | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);
  const lifetimeTimerRef = useRef<number | null>(null);
  const wardrobeDragControls = useDragControls();
  const reduceMotion = useReducedMotion();
  const currentRef = useRef(current);
  const wardrobeRef = useRef(wardrobe);
  const intentRef = useRef(intent);
  const focusedSlotRef = useRef(focusedSlot);
  const weatherRef = useRef(weather);
  const historyVersionIdsRef = useRef<string[]>([]);
  const shownOutfitIdsRef = useRef<string[]>([]);
  const operationGenerationRef = useRef(0);
  currentRef.current = current;
  wardrobeRef.current = wardrobe;
  intentRef.current = intent;
  focusedSlotRef.current = focusedSlot;
  weatherRef.current = weather;

  useEffect(() => {
    let cancelled = false;
    const operationController = operationControllerRef.current;
    void (async () => {
      await seedWardrobe(demoWardrobe);
      const experienceMode = await getExperienceMode();
      await seedPreferences(experienceMode === "personal" ? createNeutralPreferenceProfile() : demoPreferenceProfile);
      configureSounds(await getSoundEnabled());
      const weatherResponse = await fetch("/api/weather", { cache: "no-store" }).catch(() => null);
      if (weatherResponse?.ok) {
        const payload: unknown = await weatherResponse.json();
        const parsed = WeatherContextSchema.safeParse(typeof payload === "object" && payload ? (payload as { weather?: unknown }).weather : null);
        if (parsed.success) { setWeather(parsed.data); weatherRef.current = parsed.data; }
      }
      const items = await db.wardrobeItems.toArray();
      const sessions = await db.dailySessions.where("dateKey").equals(localDateKey()).toArray();
      const session = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (cancelled) return;
      setWardrobe(items);
      wardrobeRef.current = items;
      setHydrated(true);
      if (session?.currentVersionId) {
        const version = await db.outfitVersions.get(session.currentVersionId);
        if (!cancelled && version) {
          const profile = (await db.preferenceProfiles.get("default")) ?? createNeutralPreferenceProfile();
          const validForCurrentContext = validateRestoredOutfit({ version, wardrobe: items, intent: session.intent, profile, weather: weatherRef.current }).valid;
          if (!validForCurrentContext) {
            const repaired = await resetInvalidOutfitSession({ sessionId: session.id, expectedVersionId: version.id, expectedGeneration: session.operationGeneration ?? 0 });
            sessionIdRef.current = repaired.id;
            versionIdRef.current = null;
            historyVersionIdsRef.current = [];
            shownOutfitIdsRef.current = repaired.shownOutfitIds;
            operationGenerationRef.current = repaired.operationGeneration;
            setIntent(repaired.intent);
            intentRef.current = repaired.intent;
            setCurrent(null);
            currentRef.current = null;
            setHistory([]);
            setRecoveryMessage("Your wardrobe or preferences changed, so the previous outfit was cleared. Tell YiYi about today to choose a current answer.");
            setPhase("idle");
            return;
          }
          const historyIds = session.historyVersionIds ?? [];
          const historyVersions = await Promise.all(historyIds.map((id) => db.outfitVersions.get(id)));
          const validHistory = historyVersions.flatMap((entry) => entry ? [entry] : []);
          sessionIdRef.current = session.id;
          versionIdRef.current = version.id;
          historyVersionIdsRef.current = validHistory.map((entry) => entry.id);
          shownOutfitIdsRef.current = session.shownOutfitIds ?? [version.outfit.id];
          operationGenerationRef.current = session.operationGeneration ?? 0;
          setHistory(validHistory.map((entry) => entry.outfit));
          setIntent(session.intent);
          intentRef.current = session.intent;
          setCurrent(version.outfit);
          currentRef.current = version.outfit;
          setPhase(session.status === "confirmed" ? "confirmed" : "presenting");
        }
      }
    })();

    const onVisibility = () => {
      if (!document.hidden || !adapterRef.current) return;
      const hadOutfit = Boolean(currentRef.current);
      void disconnectVoice(hadOutfit ? "paused" : "idle");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      operationController.cancel();
      unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
      void adapterRef.current?.disconnect();
      adapterRef.current = null;
    };
  // The session is intentionally initialized once; refs carry the latest mutable session state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === "understanding") playSound("understood");
    if (phase === "presenting") playSound("recommendation");
    if (phase === "confirmed") playSound("confirmed");
    if (phase === "error") playSound("error");
  }, [phase]);

  function clearSessionTimers() {
    if (inactivityTimerRef.current) window.clearTimeout(inactivityTimerRef.current);
    if (lifetimeTimerRef.current) window.clearTimeout(lifetimeTimerRef.current);
    inactivityTimerRef.current = null;
    lifetimeTimerRef.current = null;
  }

  function resetInactivityTimer() {
    if (inactivityTimerRef.current) window.clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = window.setTimeout(() => void disconnectVoice(currentRef.current ? "paused" : "idle"), 90_000);
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

  const zeroAdjustments = { formality: 0, warmth: 0, comfort: 0, colorfulness: 0, walkingPriority: 0, layering: 0, structure: 0 };

  function targetedDelta(slot: OutfitSlot, request: string): IntentDelta {
    return IntentDeltaSchema.parse({ operation: "targeted_revision", targetSlots: [slot], preserveSlots: [], requiredItemIds: [], excludedItemIds: [], excludedCategories: [], adjustments: zeroAdjustments, desiredStyleTags: [], undesiredStyleTags: [], rawUtterance: request, confidence: 1, ambiguity: [] });
  }

  function randomDelta(): IntentDelta {
    return IntentDeltaSchema.parse({ operation: "random_new_outfit", targetSlots: [], preserveSlots: [], requiredItemIds: [], excludedItemIds: [], excludedCategories: [], adjustments: zeroAdjustments, desiredStyleTags: [], undesiredStyleTags: [], rawUtterance: "Choose a different outfit for the same day.", confidence: 1, ambiguity: [] });
  }

  async function executeDecision(input: { operation: "initial" | "targeted_revision" | "global_revision" | "random_new_outfit"; nextIntent?: DailyIntent; delta?: IntentDelta; utterance: string; operationToken?: OperationToken; clearInvalidCurrentOnFailure?: boolean }) {
    const before = input.operation === "initial" ? null : currentRef.current;
    if (input.operation !== "initial" && !before) return { success: false as const, summary: "There is no current outfit to revise." };
    let token = input.operationToken;
    if (!token) {
      try { token = operationControllerRef.current.begin(versionIdRef.current); }
      catch { return { success: false as const, summary: "I’m still finishing the previous outfit change." }; }
    }
    const expectedGeneration = operationGenerationRef.current;
    const sessionId = sessionIdRef.current ?? crypto.randomUUID();
    sessionIdRef.current = sessionId;
    setPhase(input.operation === "initial" ? "understanding" : "revising");
    try {
      const items = await db.wardrobeItems.toArray();
      const profile = (await db.preferenceProfiles.get("default")) ?? createNeutralPreferenceProfile();
      const decision = runRecommendationDecision({
        wardrobe: items,
        intent: input.nextIntent ?? intentRef.current,
        profile,
        weather: weatherRef.current,
        operation: input.operation,
        currentOutfit: before,
        delta: input.delta,
        shownOutfitIds: shownOutfitIdsRef.current,
        requestId: crypto.randomUUID(),
        operationId: token.id,
      });
      setPhase(input.operation === "initial" ? "generating" : "revising");
      const ranked = await rankOutfits({ candidates: decision.rankingCandidates, wardrobe: items, intent: decision.context.intent, originalUtterance: input.utterance, preferenceSummary: preferenceSummary(profile), weather: weatherRef.current, signal: token.abortController.signal });
      if (!operationControllerRef.current.isCurrent(token)) return { success: false as const, summary: "A newer outfit operation replaced this one." };
      assertDisplayedOutfitLegal(ranked.outfit, decision.context);
      operationControllerRef.current.enterCommit(token);
      const committed = await commitOutfitMutation({ sessionId, dateKey: localDateKey(), intent: decision.context.intent, weather: weatherRef.current, outfit: ranked.outfit, baseVersionId: token.baseVersionId, expectedGeneration, revisionRequest: before ? input.utterance : null });
      operationControllerRef.current.enterPublish(token);
      setWardrobe(items);
      wardrobeRef.current = items;
      setIntent(decision.context.intent);
      intentRef.current = decision.context.intent;
      versionIdRef.current = committed.versionId;
      historyVersionIdsRef.current = committed.session.historyVersionIds;
      shownOutfitIdsRef.current = committed.session.shownOutfitIds;
      operationGenerationRef.current = committed.session.operationGeneration;
      if (before) setHistory((values) => [...values, before].slice(-50));
      else setHistory([]);
      setCurrent(ranked.outfit);
      currentRef.current = ranked.outfit;
      setReason(ranked.mainReason || ranked.outfit.reason || "A legal, cohesive answer for today.");
      setRecoveryMessage(null);
      setFocusedSlot(null);
      setPhase("presenting");
      operationControllerRef.current.finish(token);
      if (input.operation === "targeted_revision") playSound("replacement");
      return { success: true as const, summary: input.operation === "targeted_revision" ? "Better. I kept every unmentioned piece." : input.operation === "random_new_outfit" ? "Here is a different legal answer for the same day." : input.operation === "global_revision" ? "This answer follows the new direction." : "I found one clear outfit for today." };
    } catch (error) {
      if (!operationControllerRef.current.isCurrent(token)) return { success: false as const, summary: "A newer outfit operation replaced this one." };
      if (input.clearInvalidCurrentOnFailure && token.baseVersionId) {
        try {
          operationControllerRef.current.enterCommit(token);
          const repaired = await resetInvalidOutfitSession({ sessionId, expectedVersionId: token.baseVersionId, expectedGeneration });
          operationControllerRef.current.enterPublish(token);
          versionIdRef.current = null;
          historyVersionIdsRef.current = [];
          operationGenerationRef.current = repaired.operationGeneration;
          setHistory([]);
          setCurrent(null);
          currentRef.current = null;
          setRecoveryMessage("That item is unavailable and no legal replacement is ready yet. Tell YiYi about today to try again.");
        } catch { /* The original mutation error remains the user-visible result. */ }
      }
      operationControllerRef.current.finish(token);
      setPhase(currentRef.current && !input.clearInvalidCurrentOnFailure ? "presenting" : "error");
      const summary = error instanceof RecommendationError ? error.message : "I could not produce a legal outfit for that request.";
      return { success: false as const, summary };
    }
  }

  const runRecommendation = (nextIntent: DailyIntent, utterance: string) => executeDecision({ operation: "initial", nextIntent, utterance });
  const revise = (slot: OutfitSlot = "bag", request = `Choose another ${slot}.`) => executeDecision({ operation: "targeted_revision", delta: targetedDelta(slot, request), utterance: request });
  const randomizeOutfit = () => executeDecision({ operation: "random_new_outfit", delta: randomDelta(), utterance: "Choose a different outfit for the same day." });

  async function undo() {
    const baseVersionId = versionIdRef.current;
    const sessionId = sessionIdRef.current;
    if (!baseVersionId || !sessionId) return false;
    let token;
    try { token = operationControllerRef.current.begin(baseVersionId); } catch { return false; }
    try {
      const [items, profile] = await Promise.all([db.wardrobeItems.toArray(), db.preferenceProfiles.get("default")]);
      const result = await undoOutfitMutation({ sessionId, baseVersionId, expectedGeneration: operationGenerationRef.current, wardrobe: items, profile: profile ?? createNeutralPreferenceProfile(), weather: weatherRef.current });
      if (!result || !operationControllerRef.current.isCurrent(token)) { operationControllerRef.current.finish(token); return false; }
      operationControllerRef.current.enterPublish(token);
      versionIdRef.current = result.versionId;
      historyVersionIdsRef.current = result.session.historyVersionIds;
      shownOutfitIdsRef.current = result.session.shownOutfitIds;
      operationGenerationRef.current = result.session.operationGeneration;
      setHistory((values) => values.slice(0, -1));
      setCurrent(result.outfit);
      currentRef.current = result.outfit;
      setReason("Back to your previous outfit.");
      setFocusedSlot(null);
      setPhase("presenting");
      operationControllerRef.current.finish(token);
      return true;
    } catch { operationControllerRef.current.finish(token); return false; }
  }

  async function confirmCurrent() {
    const outfit = currentRef.current;
    const baseVersionId = versionIdRef.current;
    const sessionId = sessionIdRef.current;
    if (!outfit || !baseVersionId || !sessionId) return { success: false as const, summary: "There is no persisted outfit to confirm." };
    let token;
    try { token = operationControllerRef.current.begin(baseVersionId); }
    catch { return { success: false as const, summary: "I’m still finishing the previous outfit change." }; }
    try {
      const profile = (await db.preferenceProfiles.get("default")) ?? createNeutralPreferenceProfile();
      const items = await db.wardrobeItems.toArray();
      const context = createRecommendationContext({ wardrobe: items, intent: intentRef.current, profile, weather: weatherRef.current, currentOutfit: outfit, operation: "initial" });
      assertDisplayedOutfitLegal(outfit, context);
      const updatedProfile = updateProfileFromOutfitFeedback({ profile, outfit, wardrobe: items, kind: "confirmed", intent: intentRef.current });
      operationControllerRef.current.enterCommit(token);
      const session = await confirmOutfitMutation({ sessionId, baseVersionId, expectedGeneration: operationGenerationRef.current, outfit, updatedProfile });
      operationControllerRef.current.enterPublish(token);
      operationGenerationRef.current = session.operationGeneration;
      await disconnectVoice();
      setPhase("confirmed");
      operationControllerRef.current.finish(token);
      return { success: true as const, summary: "Outfit decided." };
    } catch { operationControllerRef.current.finish(token); setPhase("presenting"); return { success: false as const, summary: "The outfit changed before it could be confirmed." }; }
  }

  function createHandlers(): VoiceToolHandlers {
    return {
      requestRecommendation: (nextIntent) => runRecommendation(nextIntent, nextIntent.freeformSummary),
      revise: async (input) => {
        if (input.operation === "undo") { const success = await undo(); return { success, summary: success ? "I restored the previous outfit." : "There is no previous outfit to restore." }; }
        if (input.operation === "confirm") return confirmCurrent();
        if (input.operation === "random_new_outfit") return executeDecision({ operation: "random_new_outfit", delta: input, utterance: input.rawUtterance });
        const delta = input.operation === "targeted_revision" && !input.targetSlots.length && focusedSlotRef.current ? IntentDeltaSchema.parse({ ...input, targetSlots: [focusedSlotRef.current] }) : input;
        if (delta.operation === "targeted_revision" && !delta.targetSlots.length) return { success: false, summary: "Tap the item you want to change." };
        if (delta.operation !== "targeted_revision" && delta.operation !== "global_revision") return { success: false, summary: "That revision operation is not available here." };
        return executeDecision({ operation: delta.operation, delta, utterance: delta.rawUtterance });
      },
      confirm: () => confirmCurrent(),
      setAvailability: async (input) => {
        let token: OperationToken;
        try { token = operationControllerRef.current.begin(versionIdRef.current); }
        catch { return { success: false, summary: "I’m still finishing the previous outfit change." }; }
        try {
          const focusedItemId = focusedSlotRef.current ? currentRef.current?.itemIds[focusedSlotRef.current] ?? null : null;
          const itemId = resolveAvailabilityItemId(input.itemId, focusedItemId);
          if (!itemId) { operationControllerRef.current.finish(token); return { success: false, summary: "Tap the item you mean, then tell me its availability again." }; }
          const updated = await db.wardrobeItems.update(itemId, { availability: input.availability, unavailableReason: input.reason ?? undefined, updatedAt: Date.now() });
          if (!updated) { operationControllerRef.current.finish(token); return { success: false, summary: "I could not find that wardrobe item." }; }
          const items = await db.wardrobeItems.toArray();
          setWardrobe(items);
          wardrobeRef.current = items;
          if (currentRef.current && Object.values(currentRef.current.itemIds).includes(itemId) && input.availability !== "available") {
            const delta = IntentDeltaSchema.parse({ operation: "global_revision", targetSlots: [], preserveSlots: [], requiredItemIds: [], excludedItemIds: [itemId], excludedCategories: [], adjustments: zeroAdjustments, desiredStyleTags: [], undesiredStyleTags: [], rawUtterance: input.reason || "Replace the unavailable item.", confidence: 1, ambiguity: [] });
            return executeDecision({ operation: "global_revision", delta, utterance: delta.rawUtterance, operationToken: token, clearInvalidCurrentOnFailure: true });
          }
          operationControllerRef.current.finish(token);
          return { success: true, summary: "I updated that item." };
        } catch {
          operationControllerRef.current.finish(token);
          return { success: false, summary: "I could not safely update that item." };
        }
      },
      savePreference: async (input) => {
        const profile = (await db.preferenceProfiles.get("default")) ?? createNeutralPreferenceProfile();
        const updated = saveUnstructuredVoicePreference({ profile, ...input });
        await db.preferenceProfiles.put(updated);
        return { success: true, summary: "I saved that as an editable preference note." };
      },
    };
  }

  async function startSession() {
    if (!hydrated || adapterRef.current) return;
    const resumeExisting = phase === "paused" && Boolean(currentRef.current);
    await unlockSounds();
    playSound("listen");
    if (!resumeExisting) setPhase("connecting");
    setVoiceState("connecting");
    const autoMock = typeof window !== "undefined" && localStorage.getItem("yiyi:test-auto-voice") === "true";
    const adapter = process.env.NEXT_PUBLIC_VOICE_MODE === "live" ? new OpenAIRealtimeVoiceAdapter(createHandlers()) : new MockVoiceSessionAdapter(autoMock && !resumeExisting);
    adapterRef.current = adapter;
    const onState = adapter.onState((state) => {
      resetInactivityTimer();
      setVoiceState(state);
      if (state === "connecting" && !resumeExisting) setPhase("connecting");
      if (state === "listening") setPhase((value) => resumeExisting && currentRef.current ? "presenting" : ["presenting", "revising"].includes(value) ? value : "listening");
      if (state === "thinking") setPhase((value) => ["presenting", "revising"].includes(value) ? value : "understanding");
      if (state === "error") setPhase(currentRef.current ? "paused" : "error");
    });
    const onTranscript = adapter.onTranscript((nextTranscript: TranscriptState) => {
      resetInactivityTimer();
      setTranscript(nextTranscript.text);
      if (nextTranscript.role === "user" && nextTranscript.final && process.env.NEXT_PUBLIC_VOICE_MODE !== "live") void runRecommendation(demoIntent, nextTranscript.text);
    });
    unsubscribeRef.current = [onState, onTranscript];
    lifetimeTimerRef.current = window.setTimeout(() => void disconnectVoice(currentRef.current ? "paused" : "idle"), 300_000);
    resetInactivityTimer();
    try {
      await adapter.connect();
    } catch {
      if (adapterRef.current === adapter) await disconnectVoice("error");
    }
  }

  function toggleMute() {
    const next = !muted;
    adapterRef.current?.mute(next);
    setMuted(next);
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
    await executeDecision({ operation: "global_revision", nextIntent: next, utterance: next.freeformSummary || "Update today’s intent." });
  }

  const tags = intentTags(intent);
  const activeVoice = Boolean(adapterRef.current);
  const visualState = voiceVisualState(phase, voiceState);
  const status = voiceStatus(phase, voiceState);
  const isMock = process.env.NEXT_PUBLIC_VOICE_MODE !== "live";
  return (
    <motion.main
      className="phone-page today-page"
      drag={reduceMotion ? false : "x"}
      dragListener={false}
      dragControls={wardrobeDragControls}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: .34, right: .02 }}
      dragMomentum={false}
      dragSnapToOrigin
      onPointerDown={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("button,a,input,[role=dialog]")) return;
        if (!reduceMotion) wardrobeDragControls.start(event);
      }}
      onDragEnd={(_, info) => {
        if (info.offset.x < -72 || info.velocity.x < -650) router.push("/wardrobe");
      }}
    >
      <div className="page-column">
        <header className="today-topbar">
          <Link className="today-nav-link" href="/wardrobe" aria-label="Open wardrobe"><Shirt size={18} /><span>Wardrobe</span></Link>
          <div className="weather-pill">{weather?.summary ?? "58° · Light rain"}</div>
          <Link className="icon-button" href="/settings" aria-label="Open settings"><Settings size={20} /></Link>
        </header>
        <div className="today-stage">
          <AnimatePresence initial={false} mode="popLayout">
            {phase === "idle" && <Idle key="idle" hydrated={hydrated} recoveryMessage={recoveryMessage} />}
            {["connecting", "listening", "understanding", "generating"].includes(phase) && <Listening key="listening" phase={phase} transcript={transcript} tags={tags} onEditTag={(tag) => { setEditingTag(tag); setTagDraft(tag.label); }} isMock={isMock} onUseDemo={() => adapterRef.current?.submitDemoTurn?.()} />}
            {(phase === "presenting" || phase === "revising") && current && <Result key="result" current={current} wardrobe={wardrobe} reason={reason} phase={phase} tags={tags} focusedSlot={focusedSlot} onFocus={setFocusedSlot} onEditTag={(tag) => { setEditingTag(tag); setTagDraft(tag.label); }} onRevise={revise} onUndo={() => void undo()} canUndo={history.length > 0} onRandom={() => void randomizeOutfit()} onConfirm={() => void confirmCurrent()} />}
            {phase === "paused" && <Paused key="paused" current={current} wardrobe={wardrobe} />}
            {phase === "confirmed" && current && <Confirmed key="confirmed" current={current} wardrobe={wardrobe} onRevise={() => setPhase("presenting")} />}
            {phase === "error" && <ErrorState key="error" />}
          </AnimatePresence>
        </div>
        {phase !== "confirmed" && <VoiceDock state={visualState} status={status} active={activeVoice} muted={muted} disabled={!hydrated} onPrimary={activeVoice ? undefined : () => void startSession()} onMute={activeVoice ? toggleMute : undefined} onEnd={activeVoice ? () => void disconnectVoice(currentRef.current ? "paused" : "idle") : undefined} />}
        <BottomSheet open={Boolean(editingTag)} onClose={() => setEditingTag(null)} label="Edit today’s intent">{editingTag && <IntentTagSheet tag={editingTag} value={tagDraft} onChange={setTagDraft} onSave={() => void applyTagEdit()} onRemove={() => void applyTagEdit(true)} />}</BottomSheet>
      </div>
    </motion.main>
  );
}

function MotionSection({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();
  const isPresent = useIsPresent();
  return <motion.section className={className} aria-hidden={!isPresent} inert={!isPresent ? true : undefined} style={{ pointerEvents: isPresent ? "auto" : "none" }} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 7, scale: .997 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }} transition={reduceMotion ? { duration: .12 } : calmSpring}>{children}</motion.section>;
}

function Idle({ hydrated, recoveryMessage }: { hydrated: boolean; recoveryMessage: string | null }) {
  return <MotionSection className="today-content today-idle"><div className="today-morning-mark"><VoiceCore state="idle" disabled /><span>{hydrated ? "Ready for your day" : "Opening your wardrobe…"}</span></div><div className="today-idle-copy"><h1>{copy.today.prompt}</h1><p>{recoveryMessage ?? "Describe where you’re going, how you want to feel, and what the day needs."}</p><span>“{copy.today.example}”</span></div><div className="dock-spacer" /></MotionSection>;
}

function Listening({ phase, transcript, tags, onEditTag, isMock, onUseDemo }: { phase: Phase; transcript: string; tags: IntentTag[]; onEditTag: (tag: IntentTag) => void; isMock: boolean; onUseDemo: () => void }) {
  const showTranscript = phase === "listening" || phase === "connecting";
  const timeline = phase === "connecting" ? 0 : phase === "listening" ? 1 : phase === "understanding" ? 2 : 3;
  return <MotionSection className="today-content session-content"><div className="session-timeline" aria-label="Voice progress"><span className={timeline >= 1 ? "active" : ""}>Listening</span><i /><span className={timeline >= 2 ? "active" : ""}>Understanding</span><i /><span className={timeline >= 3 ? "active" : ""}>Choosing</span></div><div className="session-focus"><AnimatePresence mode="wait">{showTranscript ? <motion.div key="transcript" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -4 }}><p className="eyebrow">Your day</p><h1 className="live-transcript">{transcript ? `“${transcript}”` : "I’m listening. Take your time."}</h1>{isMock && phase === "listening" && <button className="demo-turn-button" onClick={onUseDemo}>Continue with the demo day</button>}</motion.div> : <motion.div key="intent" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><p className="eyebrow">What YiYi understood</p><div className="chip-row understood-tags">{tags.map((tag, index) => <motion.button className="chip" key={tag.id} onClick={() => onEditTag(tag)} initial={{ opacity: 0, scale: .88 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...calmSpring, delay: index * .045 }}>{tag.label}</motion.button>)}</div></motion.div>}</AnimatePresence></div><div className="dock-spacer" /></MotionSection>;
}

function Result({ current, wardrobe, reason, phase, tags, focusedSlot, onFocus, onEditTag, onRevise, onUndo, canUndo, onRandom, onConfirm }: { current: Outfit; wardrobe: WardrobeItem[]; reason: string; phase: "presenting" | "revising"; tags: IntentTag[]; focusedSlot: OutfitSlot | null; onFocus: (slot: OutfitSlot) => void; onEditTag: (tag: IntentTag) => void; onRevise: (slot?: OutfitSlot) => void; onUndo: () => void; canUndo: boolean; onRandom: () => void; onConfirm: () => void }) {
  const mutationLocked = phase === "revising";
  return <MotionSection className="today-content result-section"><header className="result-heading"><p className="eyebrow">Today’s answer</p><h1>{copy.outfit.main}</h1><p>{reason}</p></header><div className="intent-strip">{tags.map((tag) => <button className="chip" disabled={mutationLocked} key={tag.id} onClick={() => onEditTag(tag)}>{tag.label}</button>)}</div><div className="single-outfit-stage">{phase === "revising" && <motion.div className="revision-bubble" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>Keeping every unmentioned piece still.</motion.div>}<OutfitCanvas outfit={current} wardrobe={wardrobe} onSelect={mutationLocked ? undefined : onFocus} />{phase === "revising" && <motion.div className="revision-focus-ring" data-slot={focusedSlot ?? "bag"} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} />}</div>{focusedSlot && <motion.div className="focused-item" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><span>Revise this {focusedSlot === "extraAccessory" ? "accessory" : focusedSlot}</span><SecondaryButton disabled={mutationLocked} onClick={() => onRevise(focusedSlot)}>Replace</SecondaryButton></motion.div>}<div className="result-command-row"><button disabled={!canUndo || mutationLocked} onClick={onUndo}><Undo2 size={16} />Undo</button><button disabled={mutationLocked} onClick={onRandom}><Shuffle size={16} />Another</button></div><PrimaryButton className="wear-button" disabled={mutationLocked} onClick={onConfirm}><Check size={17} />{copy.outfit.wear}</PrimaryButton><div className="dock-spacer compact" /></MotionSection>;
}

function Paused({ current, wardrobe }: { current: Outfit | null; wardrobe: WardrobeItem[] }) {
  return <MotionSection className="today-content paused-state"><div>{current ? <div className="paused-outfit"><OutfitCanvas outfit={current} wardrobe={wardrobe} /></div> : <VoiceCore state="idle" disabled />}<h1>Session paused.</h1><p>Your outfit and understanding are still here. Tap the Voice Dock to reconnect.</p></div><div className="dock-spacer" /></MotionSection>;
}

function Confirmed({ current, wardrobe, onRevise }: { current: Outfit; wardrobe: WardrobeItem[]; onRevise: () => void }) {
  return <MotionSection className="today-content confirmed-state"><YiYiMarkWithAccent /><h1>{copy.outfit.confirmedTitle}</h1><p>{copy.outfit.confirmedBody}</p><div className="confirmed-outfit"><OutfitCanvas outfit={current} wardrobe={wardrobe} /></div><div className="confirmed-actions"><PrimaryButton onClick={onRevise}>See today’s outfit</PrimaryButton><Link href="/wardrobe" className="secondary-button">Open wardrobe</Link></div></MotionSection>;
}

function YiYiMarkWithAccent() { return <div className="confirmed-mark"><VoiceCore state="idle" disabled /><span /><span /></div>; }

function IntentTagSheet({ tag, value, onChange, onSave, onRemove }: { tag: IntentTag; value: string; onChange: (value: string) => void; onSave: () => void; onRemove: () => void }) {
  return <><h2>Edit today’s intent</h2><p className="secondary-copy">This changes today only and creates one refreshed answer.</p>{tag.kind !== "excluded" && <input className="sheet-input" aria-label="Intent tag" value={value} onChange={(event) => onChange(event.target.value)} />}<div className="sheet-actions"><SecondaryButton onClick={onRemove}>{tag.kind === "excluded" ? "Allow this today" : "Remove tag"}</SecondaryButton>{tag.kind !== "excluded" && <PrimaryButton disabled={!value.trim()} onClick={onSave}>Update outfit</PrimaryButton>}</div></>;
}

function ErrorState() {
  return <MotionSection className="today-content error-state"><div><VoiceCore state="error" disabled /><h1>YiYi couldn’t finish that.</h1><p>Your wardrobe is safe. Tap the Voice Dock to try the session again.</p></div><div className="dock-spacer" /></MotionSection>;
}
