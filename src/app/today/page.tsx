"use client";

import "swiper/css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion, useIsPresent, useReducedMotionConfig } from "motion/react";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import { Check, Settings, Shirt, Shuffle, Undo2 } from "lucide-react";
import { WardrobePanel } from "@/app/wardrobe/page";
import { OutfitCanvas } from "@/components/outfit/outfit-canvas";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { VoiceCore, VoiceDock, type VoiceVisualState } from "@/components/voice/voice-core";
import { copy } from "@/content/copy";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { updateProfileFromOutfitFeedback } from "@/domain/preferences/feedback";
import { recommendationPreferenceSummary } from "@/domain/preferences/summary";
import { assertDisplayedOutfitLegal, runRecommendationDecision, validateRestoredOutfit } from "@/domain/recommendation/engine";
import { createRecommendationContext, RecommendationError } from "@/domain/recommendation/context";
import { IntentDeltaSchema, WeatherContextSchema, type DailyIntent, type IntentDelta, type Outfit, type OutfitSlot, type WardrobeItem, type WeatherContext } from "@/domain/schemas";
import { configureSounds, playSound, unlockSounds } from "@/lib/audio/sound-system";
import { calmSpring } from "@/lib/motion/tokens";
import { MockVoiceSessionAdapter, OpenAIRealtimeVoiceAdapter, resolveAvailabilityItemId, type VoiceToolHandlers } from "@/lib/realtime/voice-session";
import { voiceSessionCoordinator, voiceSessionServerSnapshot, type VoiceLifecycleStatus, type VoiceSessionSnapshot } from "@/lib/realtime/voice-session-coordinator";
import { persistPreferenceDelta } from "@/lib/preferences/profile-storage";
import { rankOutfits } from "@/lib/recommendation/client-ranking";
import { RecommendationOperationController, runCommitPhase, type OperationToken } from "@/lib/recommendation/operation-controller";
import { commitOutfitMutation, confirmOutfitMutation, resetInvalidOutfitSession, undoOutfitMutation, updateItemAvailabilityMutation } from "@/lib/recommendation/session-mutations";
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

function voiceVisualState(phase: Phase, voiceState: VoiceLifecycleStatus): VoiceVisualState {
  if (voiceState === "rate_limited") return "error";
  if (phase === "understanding" || phase === "generating" || phase === "revising") return "thinking";
  return voiceState;
}

function voiceStatus(phase: Phase, voice: VoiceSessionSnapshot) {
  if (voice.status === "rate_limited") return "Too many starts · Try again after the cooldown";
  if (voice.status === "error" || phase === "error") {
    if (voice.stage === "permission") return "Microphone access is needed · Tap to retry";
    if (voice.stage === "token") return "Voice access is unavailable · Tap to retry";
    if (voice.stage === "webrtc" || voice.stage === "ready") return "Voice connection failed · Tap to retry";
    return "Voice didn’t start · Tap to retry";
  }
  if (voice.status === "connecting") return "Connecting…";
  if (phase === "understanding") return "Understanding…";
  if (phase === "generating") return "Creating one clear answer…";
  if (phase === "revising") return "Revising…";
  if (phase === "paused") return "Session paused · Tap to reconnect";
  if (voice.status === "speaking") return "YiYi is speaking…";
  if (voice.status === "interrupted") return "Interrupted · Listening again…";
  if (phase === "presenting") return "YiYi is listening…";
  if (phase === "confirmed") return "Outfit decided";
  return voice.status === "listening" ? "Listening…" : "Tap to talk";
}

export function TodayPage() {
  const pagerRef = useRef<SwiperInstance | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const voiceSnapshot = useSyncExternalStore(voiceSessionCoordinator.subscribe, voiceSessionCoordinator.getSnapshot, voiceSessionServerSnapshot);
  const transcript = voiceSnapshot.owner === "today" ? voiceSnapshot.transcript?.text ?? "" : "";
  const [hydrated, setHydrated] = useState(false);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [intent, setIntent] = useState<DailyIntent>(demoIntent);
  const [current, setCurrent] = useState<Outfit | null>(null);
  const [reason, setReason] = useState<string>(copy.outfit.reason);
  const [history, setHistory] = useState<Outfit[]>([]);
  const [focusedSlot, setFocusedSlot] = useState<OutfitSlot | null>(null);
  const [muted, setMuted] = useState(false);
  const [editingTag, setEditingTag] = useState<IntentTag | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [weather, setWeather] = useState<WeatherContext | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const operationControllerRef = useRef(new RecommendationOperationController());
  const sessionIdRef = useRef<string | null>(null);
  const versionIdRef = useRef<string | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);
  const lifetimeTimerRef = useRef<number | null>(null);
  const currentRef = useRef(current);
  const wardrobeRef = useRef(wardrobe);
  const intentRef = useRef(intent);
  const focusedSlotRef = useRef(focusedSlot);
  const weatherRef = useRef(weather);
  const historyVersionIdsRef = useRef<string[]>([]);
  const shownOutfitIdsRef = useRef<string[]>([]);
  const operationGenerationRef = useRef(0);
  const handledTranscriptRef = useRef<string | null>(null);
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
      if (!document.hidden || voiceSessionCoordinator.getSnapshot().owner !== "today") return;
      const hadOutfit = Boolean(currentRef.current);
      void disconnectVoice(hadOutfit ? "paused" : "idle");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      operationController.cancel();
      clearSessionTimers();
      void voiceSessionCoordinator.stop("today", "cleanup");
    };
  // The session is intentionally initialized once; refs carry the latest mutable session state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (voiceSnapshot.owner !== "today") return;
    if (["connecting", "listening", "thinking", "speaking", "interrupted"].includes(voiceSnapshot.status)) resetInactivityTimer();
    if (voiceSnapshot.status === "connecting" && !currentRef.current) setPhase("connecting");
    if (voiceSnapshot.status === "listening") setPhase((value) => currentRef.current ? (value === "revising" ? value : "presenting") : "listening");
    if (voiceSnapshot.status === "thinking") setPhase((value) => currentRef.current ? (value === "revising" ? value : "presenting") : "understanding");
    if (voiceSnapshot.status === "error" || voiceSnapshot.status === "rate_limited") {
      operationControllerRef.current.cancel();
      setPhase(currentRef.current ? "paused" : "error");
    }
  // The coordinator snapshot is the only connection-state input; timer helpers use refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSnapshot.owner, voiceSnapshot.status]);

  useEffect(() => {
    const nextTranscript = voiceSnapshot.transcript;
    if (voiceSnapshot.owner !== "today" || !nextTranscript) return;
    if (nextTranscript.role !== "user" || !nextTranscript.final || process.env.NEXT_PUBLIC_VOICE_MODE === "live") return;
    const key = `${voiceSnapshot.generation}:${nextTranscript.text}`;
    if (handledTranscriptRef.current === key) return;
    handledTranscriptRef.current = key;
    void runRecommendation(demoIntent, nextTranscript.text);
  // runRecommendation reads current refs and is intentionally triggered only by a new final mock transcript.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSnapshot.generation, voiceSnapshot.owner, voiceSnapshot.transcript]);

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
    operationControllerRef.current.cancel();
    await voiceSessionCoordinator.stop("today", nextPhase === "paused" ? "background" : "user");
    if (nextPhase) setPhase(nextPhase);
  }

  const zeroAdjustments = { formality: 0, warmth: 0, comfort: 0, colorfulness: 0, walkingPriority: 0, layering: 0, structure: 0 };

  function targetedDelta(slot: OutfitSlot, request: string): IntentDelta {
    return IntentDeltaSchema.parse({ operation: "targeted_revision", targetSlots: [slot], preserveSlots: [], requiredItemIds: [], excludedItemIds: [], excludedCategories: [], adjustments: zeroAdjustments, desiredStyleTags: [], undesiredStyleTags: [], rawUtterance: request, confidence: 1, ambiguity: [] });
  }

  function randomDelta(): IntentDelta {
    return IntentDeltaSchema.parse({ operation: "random_new_outfit", targetSlots: [], preserveSlots: [], requiredItemIds: [], excludedItemIds: [], excludedCategories: [], adjustments: zeroAdjustments, desiredStyleTags: [], undesiredStyleTags: [], rawUtterance: "Choose a different outfit for the same day.", confidence: 1, ambiguity: [] });
  }

  async function executeDecision(input: { operation: "initial" | "targeted_revision" | "global_revision" | "random_new_outfit"; nextIntent?: DailyIntent; delta?: IntentDelta; utterance: string; operationToken?: OperationToken; clearInvalidCurrentOnFailure?: boolean; voiceGeneration?: number }) {
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
      if (input.voiceGeneration !== undefined && !voiceSessionCoordinator.isCurrent("today", input.voiceGeneration)) {
        operationControllerRef.current.finish(token);
        return { success: false as const, summary: "That voice session has already ended." };
      }
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
      const ranked = await rankOutfits({
        candidates: decision.rankingCandidates,
        wardrobe: items,
        intent: decision.context.intent,
        originalUtterance: input.utterance,
        preferenceSummary: recommendationPreferenceSummary(profile),
        weather: weatherRef.current,
        signal: token.abortController.signal,
        recommendationOperationId: `${sessionId}:${token.id}`,
        profileVersion: profile.revision,
        outfitVersion: token.baseVersionId,
      });
      if (!operationControllerRef.current.isCurrent(token)) return { success: false as const, summary: "A newer outfit operation replaced this one." };
      if (input.voiceGeneration !== undefined && !voiceSessionCoordinator.isCurrent("today", input.voiceGeneration)) {
        operationControllerRef.current.finish(token);
        setPhase(currentRef.current ? "presenting" : "idle");
        return { success: false as const, summary: "That voice session has already ended." };
      }
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

  async function undo(voiceGeneration?: number) {
    const baseVersionId = versionIdRef.current;
    const sessionId = sessionIdRef.current;
    if (!baseVersionId || !sessionId) return false;
    let token;
    try { token = operationControllerRef.current.begin(baseVersionId); } catch { return false; }
    try {
      const [items, profile] = await Promise.all([db.wardrobeItems.toArray(), db.preferenceProfiles.get("default")]);
      if (voiceGeneration !== undefined && !voiceSessionCoordinator.isCurrent("today", voiceGeneration)) {
        operationControllerRef.current.finish(token);
        return false;
      }
      const result = await runCommitPhase(operationControllerRef.current, token, () => undoOutfitMutation({ sessionId, baseVersionId, expectedGeneration: operationGenerationRef.current, wardrobe: items, profile: profile ?? createNeutralPreferenceProfile(), weather: weatherRef.current }));
      if (!result || !operationControllerRef.current.isCurrent(token)) { operationControllerRef.current.finish(token); return false; }
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

  async function confirmCurrent(voiceGeneration?: number) {
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
      const updatedProfile = updateProfileFromOutfitFeedback({ profile, outfit, wardrobe: items, kind: "confirmed", intent: intentRef.current, contextId: sessionId });
      if (voiceGeneration !== undefined && !voiceSessionCoordinator.isCurrent("today", voiceGeneration)) {
        operationControllerRef.current.finish(token);
        return { success: false as const, summary: "That voice session has already ended." };
      }
      const session = await runCommitPhase(operationControllerRef.current, token, () => confirmOutfitMutation({ sessionId, baseVersionId, expectedGeneration: operationGenerationRef.current, outfit, updatedProfile }));
      operationGenerationRef.current = session.operationGeneration;
      await disconnectVoice();
      setPhase("confirmed");
      operationControllerRef.current.finish(token);
      return { success: true as const, summary: "Outfit decided." };
    } catch { operationControllerRef.current.finish(token); setPhase("presenting"); return { success: false as const, summary: "The outfit changed before it could be confirmed." }; }
  }

  function createHandlers(voiceGeneration: number): VoiceToolHandlers {
    const currentVoice = () => voiceSessionCoordinator.isCurrent("today", voiceGeneration);
    const staleVoice = () => ({ success: false, summary: "That voice session has already ended." });
    return {
      requestRecommendation: (nextIntent) => currentVoice() ? executeDecision({ operation: "initial", nextIntent, utterance: nextIntent.freeformSummary, voiceGeneration }) : Promise.resolve(staleVoice()),
      revise: async (input) => {
        if (!currentVoice()) return staleVoice();
        if (input.operation === "undo") { const success = await undo(voiceGeneration); return { success, summary: success ? "I restored the previous outfit." : currentVoice() ? "There is no previous outfit to restore." : "That voice session has already ended." }; }
        if (input.operation === "confirm") return confirmCurrent(voiceGeneration);
        if (input.operation === "random_new_outfit") return executeDecision({ operation: "random_new_outfit", delta: input, utterance: input.rawUtterance, voiceGeneration });
        const delta = input.operation === "targeted_revision" && !input.targetSlots.length && focusedSlotRef.current ? IntentDeltaSchema.parse({ ...input, targetSlots: [focusedSlotRef.current] }) : input;
        if (delta.operation === "targeted_revision" && !delta.targetSlots.length) return { success: false, summary: "Tap the item you want to change." };
        if (delta.operation !== "targeted_revision" && delta.operation !== "global_revision") return { success: false, summary: "That revision operation is not available here." };
        return executeDecision({ operation: delta.operation, delta, utterance: delta.rawUtterance, voiceGeneration });
      },
      confirm: () => currentVoice() ? confirmCurrent(voiceGeneration) : Promise.resolve(staleVoice()),
      setAvailability: async (input) => {
        if (!currentVoice()) return staleVoice();
        let token: OperationToken;
        try { token = operationControllerRef.current.begin(versionIdRef.current); }
        catch { return { success: false, summary: "I’m still finishing the previous outfit change." }; }
        try {
          const focusedItemId = focusedSlotRef.current ? currentRef.current?.itemIds[focusedSlotRef.current] ?? null : null;
          const itemId = resolveAvailabilityItemId(input.itemId, focusedItemId);
          if (!itemId) { operationControllerRef.current.finish(token); return { success: false, summary: "Tap the item you mean, then tell me its availability again." }; }
          if (!currentVoice()) { operationControllerRef.current.finish(token); return staleVoice(); }
          operationControllerRef.current.enterCommit(token);
          const items = await updateItemAvailabilityMutation({ itemId, availability: input.availability, reason: input.reason });
          if (!items) { operationControllerRef.current.finish(token); return { success: false, summary: "I could not find that wardrobe item." }; }
          if (currentRef.current && Object.values(currentRef.current.itemIds).includes(itemId) && input.availability !== "available") {
            const delta = IntentDeltaSchema.parse({ operation: "global_revision", targetSlots: [], preserveSlots: [], requiredItemIds: [], excludedItemIds: [itemId], excludedCategories: [], adjustments: zeroAdjustments, desiredStyleTags: [], undesiredStyleTags: [], rawUtterance: input.reason || "Replace the unavailable item.", confidence: 1, ambiguity: [] });
            return executeDecision({ operation: "global_revision", delta, utterance: delta.rawUtterance, operationToken: token, clearInvalidCurrentOnFailure: true });
          }
          operationControllerRef.current.enterPublish(token);
          setWardrobe(items);
          wardrobeRef.current = items;
          operationControllerRef.current.finish(token);
          return { success: true, summary: "I updated that item." };
        } catch {
          operationControllerRef.current.finish(token);
          return { success: false, summary: "I could not safely update that item." };
        }
      },
      savePreference: async (input) => {
        if (!currentVoice()) return staleVoice();
        try {
          const updated = await persistPreferenceDelta(input, "explicit_voice");
          if (!currentVoice()) return staleVoice();
          const saved = updated.preferenceSignals?.find((signal) => signal.id === input.signalId)
            ?? updated.preferenceSignals?.find((signal) => signal.label === input.label && signal.status !== "deleted");
          return saved?.status === "needs_review"
            ? { success: true, summary: "I saved that as an editable note for review." }
            : { success: true, summary: "I saved that as an editable long-term preference." };
        } catch {
          return { success: false, summary: "I understood that, but I could not safely save it." };
        }
      },
    };
  }

  async function startSession() {
    const connection = voiceSessionCoordinator.getSnapshot();
    if (!hydrated || operationControllerRef.current.isBusy() || ["connecting", "listening", "thinking", "speaking", "interrupted"].includes(connection.status)) return;
    const resumeExisting = phase === "paused" && Boolean(currentRef.current);
    await unlockSounds();
    playSound("listen");
    if (!resumeExisting) setPhase("connecting");
    const autoMock = typeof window !== "undefined" && localStorage.getItem("yiyi:test-auto-voice") === "true";
    lifetimeTimerRef.current = window.setTimeout(() => void disconnectVoice(currentRef.current ? "paused" : "idle"), 300_000);
    resetInactivityTimer();
    try {
      await voiceSessionCoordinator.start("today", ({ attemptId, generation }) => process.env.NEXT_PUBLIC_VOICE_MODE === "live"
        ? new OpenAIRealtimeVoiceAdapter(createHandlers(generation), { attemptId, sessionGeneration: generation, purpose: "today" })
        : new MockVoiceSessionAdapter(autoMock && !resumeExisting));
    } catch {
      clearSessionTimers();
      setPhase(currentRef.current ? "paused" : "error");
    }
  }

  function toggleMute() {
    const next = !muted;
    voiceSessionCoordinator.mute("today", next);
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
  const activeVoice = voiceSnapshot.owner === "today" && ["connecting", "listening", "thinking", "speaking", "interrupted"].includes(voiceSnapshot.status);
  const visualState = voiceVisualState(phase, voiceSnapshot.status);
  const status = voiceStatus(phase, voiceSnapshot);
  const isMock = process.env.NEXT_PUBLIC_VOICE_MODE !== "live";
  return (
    <main className="phone-page today-page pager-page">
      <Swiper
        className="today-wardrobe-pager"
        slidesPerView={1}
        speed={420}
        followFinger
        touchAngle={48}
        threshold={4}
        shortSwipes
        longSwipes
        longSwipesRatio={0.18}
        longSwipesMs={320}
        resistance
        resistanceRatio={0.72}
        edgeSwipeDetection
        edgeSwipeThreshold={18}
        maxBackfaceHiddenSlides={2}
        noSwiping
        noSwipingSelector="button,a,input,textarea,select,[role=dialog],.swiper-no-swiping"
        allowTouchMove={!editingTag}
        onSwiper={(swiper) => { pagerRef.current = swiper; }}
        onSlideChange={(swiper) => setActivePage(swiper.activeIndex)}
      >
      <SwiperSlide><section className="pager-slide" aria-label="Today page" aria-hidden={activePage !== 0} inert={activePage !== 0 ? true : undefined}><div className="page-column">
        <header className="today-topbar">
          <button className="today-nav-link" type="button" onClick={() => pagerRef.current?.slideTo(1)} aria-label="Open wardrobe"><Shirt size={18} /><span>Wardrobe</span></button>
          <div className="weather-pill">{weather?.summary ?? "58° · Light rain"}</div>
          <Link className="icon-button" href="/settings" aria-label="Open settings"><Settings size={20} /></Link>
        </header>
        <div className="today-stage">
          <AnimatePresence initial={false} mode="popLayout">
            {phase === "idle" && <Idle key="idle" hydrated={hydrated} recoveryMessage={recoveryMessage} />}
            {["connecting", "listening", "understanding", "generating"].includes(phase) && <Listening key="listening" phase={phase} transcript={transcript} tags={tags} onEditTag={(tag) => { setEditingTag(tag); setTagDraft(tag.label); }} isMock={isMock} onUseDemo={() => voiceSessionCoordinator.submitDemoTurn("today")} />}
            {(phase === "presenting" || phase === "revising") && current && <Result key="result" current={current} wardrobe={wardrobe} reason={reason} phase={phase} tags={tags} focusedSlot={focusedSlot} onFocus={setFocusedSlot} onEditTag={(tag) => { setEditingTag(tag); setTagDraft(tag.label); }} onRevise={revise} onUndo={() => void undo()} canUndo={history.length > 0} onRandom={() => void randomizeOutfit()} onConfirm={() => void confirmCurrent()} />}
            {phase === "paused" && <Paused key="paused" current={current} wardrobe={wardrobe} />}
            {phase === "confirmed" && current && <Confirmed key="confirmed" current={current} wardrobe={wardrobe} onRevise={() => setPhase("presenting")} onOpenWardrobe={() => pagerRef.current?.slideTo(1)} />}
            {phase === "error" && <ErrorState key="error" />}
          </AnimatePresence>
        </div>
        {phase !== "confirmed" && <VoiceDock state={visualState} status={status} active={activeVoice} muted={muted} disabled={!hydrated} onPrimary={activeVoice ? undefined : () => void startSession()} onMute={activeVoice ? toggleMute : undefined} onEnd={activeVoice ? () => void disconnectVoice(currentRef.current ? "paused" : "idle") : undefined} />}
        <BottomSheet open={Boolean(editingTag)} onClose={() => setEditingTag(null)} label="Edit today’s intent">{editingTag && <IntentTagSheet tag={editingTag} value={tagDraft} onChange={setTagDraft} onSave={() => void applyTagEdit()} onRemove={() => void applyTagEdit(true)} />}</BottomSheet>
      </div></section></SwiperSlide>
      <SwiperSlide><section className="pager-slide" aria-label="Wardrobe slide" aria-hidden={activePage !== 1} inert={activePage !== 1 ? true : undefined}><WardrobePanel embedded onBack={() => pagerRef.current?.slideTo(0)} /></section></SwiperSlide>
      </Swiper>
    </main>
  );
}

function MotionSection({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduceMotion = useReducedMotionConfig();
  const isPresent = useIsPresent();
  return <motion.section className={className} aria-hidden={!isPresent} inert={!isPresent ? true : undefined} style={{ pointerEvents: isPresent ? "auto" : "none" }} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(7px) scale(.997)" }} animate={{ opacity: 1, transform: "translateY(0) scale(1)" }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(-4px) scale(.998)" }} transition={reduceMotion ? { duration: .12 } : calmSpring}>{children}</motion.section>;
}

function Idle({ hydrated, recoveryMessage }: { hydrated: boolean; recoveryMessage: string | null }) {
  return <MotionSection className="today-content today-idle"><div className="today-morning-mark"><VoiceCore state="idle" disabled /><span>{hydrated ? "Ready for your day" : "Opening your wardrobe…"}</span></div><div className="today-idle-copy"><h1>{copy.today.prompt}</h1><p>{recoveryMessage ?? "Describe where you’re going, how you want to feel, and what the day needs."}</p><span>“{copy.today.example}”</span></div><div className="dock-spacer" /></MotionSection>;
}

function Listening({ phase, transcript, tags, onEditTag, isMock, onUseDemo }: { phase: Phase; transcript: string; tags: IntentTag[]; onEditTag: (tag: IntentTag) => void; isMock: boolean; onUseDemo: () => void }) {
  const reduceMotion = useReducedMotionConfig();
  const showTranscript = phase === "listening" || phase === "connecting";
  const timeline = phase === "connecting" ? 0 : phase === "listening" ? 1 : phase === "understanding" ? 2 : 3;
  return <MotionSection className="today-content session-content"><div className="session-timeline" aria-label="Voice progress"><span className={timeline >= 1 ? "active" : ""}>Listening</span><i /><span className={timeline >= 2 ? "active" : ""}>Understanding</span><i /><span className={timeline >= 3 ? "active" : ""}>Choosing</span></div><div className="session-focus"><AnimatePresence mode="wait">{showTranscript ? <motion.div key="transcript" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(-4px)" }}><p className="eyebrow">Your day</p><h1 className="live-transcript">{transcript ? `“${transcript}”` : "I’m listening. Take your time."}</h1>{isMock && phase === "listening" && <button className="demo-turn-button" onClick={onUseDemo}>Continue with the demo day</button>}</motion.div> : <motion.div key="intent" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(7px)" }} animate={{ opacity: 1, transform: "translateY(0)" }}><p className="eyebrow">What YiYi understood</p><LayoutGroup id="today-intent-tags"><motion.div className="chip-row understood-tags" layout><AnimatePresence initial={false} mode="popLayout">{tags.map((tag) => <motion.button className="chip" layout key={tag.id} onClick={() => onEditTag(tag)} initial={{ opacity: 0, transform: "scale(.97)" }} animate={{ opacity: 1, transform: "scale(1)" }} exit={{ opacity: 0, transform: "scale(.97)" }} transition={{ duration: reduceMotion ? .1 : .18, ease: [.23, 1, .32, 1] }}>{tag.label}</motion.button>)}</AnimatePresence></motion.div></LayoutGroup></motion.div>}</AnimatePresence></div><div className="dock-spacer" /></MotionSection>;
}

function Result({ current, wardrobe, reason, phase, tags, focusedSlot, onFocus, onEditTag, onRevise, onUndo, canUndo, onRandom, onConfirm }: { current: Outfit; wardrobe: WardrobeItem[]; reason: string; phase: "presenting" | "revising"; tags: IntentTag[]; focusedSlot: OutfitSlot | null; onFocus: (slot: OutfitSlot) => void; onEditTag: (tag: IntentTag) => void; onRevise: (slot?: OutfitSlot) => void; onUndo: () => void; canUndo: boolean; onRandom: () => void; onConfirm: () => void }) {
  const reduceMotion = useReducedMotionConfig();
  const mutationLocked = phase === "revising";
  return <MotionSection className="today-content result-section"><header className="result-heading"><p className="eyebrow">Today’s answer</p><h1>{copy.outfit.main}</h1><motion.p key={reason} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .18 }}>{reason}</motion.p></header><div className="intent-strip">{tags.map((tag) => <button className="chip" disabled={mutationLocked} key={tag.id} onClick={() => onEditTag(tag)}>{tag.label}</button>)}</div><div className="single-outfit-stage"><AnimatePresence initial={false}>{phase === "revising" && <motion.div className="revision-bubble" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(5px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>Keeping every unmentioned piece still.</motion.div>}</AnimatePresence><OutfitCanvas outfit={current} wardrobe={wardrobe} onSelect={mutationLocked ? undefined : onFocus} /><AnimatePresence initial={false}>{phase === "revising" && <motion.div className="revision-focus-ring" data-slot={focusedSlot ?? "bag"} initial={{ opacity: 0, transform: "scale(.96)" }} animate={{ opacity: 1, transform: "scale(1)" }} exit={{ opacity: 0 }} transition={{ duration: .18 }} />}</AnimatePresence></div><AnimatePresence initial={false} mode="popLayout">{focusedSlot && <motion.div className="focused-item" key={focusedSlot} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(6px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} exit={{ opacity: 0 }} transition={{ duration: .18 }}><span>Revise this {focusedSlot === "extraAccessory" ? "accessory" : focusedSlot}</span><SecondaryButton disabled={mutationLocked} onClick={() => onRevise(focusedSlot)}>Replace</SecondaryButton></motion.div>}</AnimatePresence><div className="result-command-row"><button disabled={!canUndo || mutationLocked} onClick={onUndo}><Undo2 size={16} />Undo</button><button disabled={mutationLocked} onClick={onRandom}><Shuffle size={16} />Another</button></div><PrimaryButton className="wear-button" disabled={mutationLocked} onClick={onConfirm}><Check size={17} />{copy.outfit.wear}</PrimaryButton><div className="dock-spacer compact" /></MotionSection>;
}

function Paused({ current, wardrobe }: { current: Outfit | null; wardrobe: WardrobeItem[] }) {
  return <MotionSection className="today-content paused-state"><div>{current ? <div className="paused-outfit"><OutfitCanvas outfit={current} wardrobe={wardrobe} /></div> : <VoiceCore state="idle" disabled />}<h1>Session paused.</h1><p>Your outfit and understanding are still here. Tap the Voice Dock to reconnect.</p></div><div className="dock-spacer" /></MotionSection>;
}

function Confirmed({ current, wardrobe, onRevise, onOpenWardrobe }: { current: Outfit; wardrobe: WardrobeItem[]; onRevise: () => void; onOpenWardrobe: () => void }) {
  return <MotionSection className="today-content confirmed-state"><YiYiMarkWithAccent /><h1>{copy.outfit.confirmedTitle}</h1><p>{copy.outfit.confirmedBody}</p><div className="confirmed-outfit"><OutfitCanvas outfit={current} wardrobe={wardrobe} /></div><div className="confirmed-actions"><PrimaryButton onClick={onRevise}>See today’s outfit</PrimaryButton><button type="button" onClick={onOpenWardrobe} className="secondary-button">Open wardrobe</button></div></MotionSection>;
}

function YiYiMarkWithAccent() { return <div className="confirmed-mark"><VoiceCore state="idle" disabled /><span /><span /></div>; }

function IntentTagSheet({ tag, value, onChange, onSave, onRemove }: { tag: IntentTag; value: string; onChange: (value: string) => void; onSave: () => void; onRemove: () => void }) {
  return <><h2>Edit today’s intent</h2><p className="secondary-copy">This changes today only and creates one refreshed answer.</p>{tag.kind !== "excluded" && <input className="sheet-input" aria-label="Intent tag" value={value} onChange={(event) => onChange(event.target.value)} />}<div className="sheet-actions"><SecondaryButton onClick={onRemove}>{tag.kind === "excluded" ? "Allow this today" : "Remove tag"}</SecondaryButton>{tag.kind !== "excluded" && <PrimaryButton disabled={!value.trim()} onClick={onSave}>Update outfit</PrimaryButton>}</div></>;
}

function ErrorState() {
  return <MotionSection className="today-content error-state"><div><VoiceCore state="error" disabled /><h1>YiYi couldn’t finish that.</h1><p>Your wardrobe is safe. Tap the Voice Dock to try the session again.</p></div><div className="dock-spacer" /></MotionSection>;
}

export default TodayPage;
