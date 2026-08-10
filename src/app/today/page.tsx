"use client";

import "swiper/css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion, useIsPresent, useReducedMotionConfig } from "motion/react";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import { Check, Settings, Shirt, Shuffle, Undo2 } from "lucide-react";
import { WardrobePanel } from "@/components/wardrobe/wardrobe-panel";
import { OutfitCanvas } from "@/components/outfit/outfit-canvas";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { VoiceCore, VoiceDock, type VoiceVisualState } from "@/components/voice/voice-core";
import { EditableVoiceTranscript } from "@/components/voice/editable-voice-transcript";
import { copy } from "@/content/copy";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { updateProfileFromOutfitFeedback } from "@/domain/preferences/feedback";
import { recommendationPreferenceSummary } from "@/domain/preferences/summary";
import { assertDisplayedOutfitLegal, runRecommendationDecision, validateRestoredOutfit } from "@/domain/recommendation/engine";
import { createRecommendationContext, RecommendationError } from "@/domain/recommendation/context";
import { outfitMutationProof, voiceActionToIntentDelta } from "@/domain/recommendation/voice-action-router";
import { buildDailyIntentFromVoiceRequest, emptyDailyIntent } from "@/domain/recommendation/voice-intent";
import { IntentDeltaSchema, type DailyIntent, type IntentDelta, type Outfit, type OutfitSlot, type WardrobeItem, type WeatherContext } from "@/domain/schemas";
import { configureSounds, playSound, unlockSounds } from "@/lib/audio/sound-system";
import { calmSpring } from "@/lib/motion/tokens";
import { MockVoiceSessionAdapter, OpenAIRealtimeVoiceAdapter, resolveAvailabilityItemId, type VoiceToolHandlers, type VoiceTurnAction } from "@/lib/realtime/voice-session";
import { voiceSessionCoordinator, voiceSessionServerSnapshot, type VoiceLifecycleStatus, type VoiceSessionSnapshot } from "@/lib/realtime/voice-session-coordinator";
import { persistPreferenceDelta } from "@/lib/preferences/profile-storage";
import { BrowserPreferenceVoiceAdapter } from "@/lib/realtime/preference-voice-adapter";
import { interpretBrowserVoiceTranscript } from "@/lib/realtime/browser-voice-language";
import { rankOutfits } from "@/lib/recommendation/client-ranking";
import { RecommendationOperationController, runCommitPhase, type OperationToken } from "@/lib/recommendation/operation-controller";
import { commitOutfitMutation, confirmOutfitMutation, resetInvalidOutfitSession, undoOutfitMutation, updateItemAvailabilityMutation } from "@/lib/recommendation/session-mutations";
import { db, getSoundEnabled, getWardrobeItemsForCurrentMode } from "@/lib/storage/db";
import { configuredWeatherMode, fetchConfiguredWeather, getStoredWeatherState, resolveWeatherForSession, usableCachedWeather, type WeatherSource } from "@/lib/weather/client";

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

function voiceVisualState(phase: Phase, voiceState: VoiceLifecycleStatus, action: VoiceTurnAction["action"] | null): VoiceVisualState {
  if (voiceState === "rate_limited") return "error";
  if (voiceState === "recoverable_error") return "recoverable_error";
  if (phase === "revising" && (action === "revise" || action === "remove" || action === "random" || action === "set_availability")) return "revising";
  if (phase === "generating") return "tool_running";
  if (phase === "understanding") return "understanding";
  return voiceState;
}

function voiceStatus(phase: Phase, voice: VoiceSessionSnapshot, action: VoiceTurnAction["action"] | null) {
  if (voice.status === "rate_limited") return "Too many starts · Try again after the cooldown";
  if (voice.status === "recoverable_error" || phase === "error") {
    if (voice.stage === "permission") return "Microphone access is needed · Tap to retry";
    if (voice.stage === "token") return "Voice access is unavailable · Tap to retry";
    if (voice.stage === "webrtc") return "Voice connection failed · Tap to retry";
    if (voice.stage === "ready") return "Voice connection failed · Tap to retry";
    return "That didn’t go through. Tap to try again.";
  }
  if (voice.status === "connecting") return "Connecting…";
  if (voice.status === "committing") return "Finishing your turn…";
  if (action === "confirm") return "Confirming your outfit…";
  if (action === "undo") return "Restoring the previous outfit…";
  if (action === "random") return "Choosing another legal outfit…";
  if (action === "set_availability") return "Updating availability…";
  if (action === "no_change") return "Listening when you’re ready…";
  if (action === "revise" || action === "remove") return "Revising…";
  if (voice.status === "tool_running") return "Choosing…";
  if (voice.status === "revising") return "Revising…";
  if (phase === "understanding") return "Understanding…";
  if (phase === "generating") return "Creating one clear answer…";
  if (phase === "revising") return "Revising…";
  if (phase === "paused") return "Session paused · Tap to reconnect";
  if (voice.status === "speaking") return "YiYi is speaking…";
  if (voice.status === "interrupted") return "Interrupted · Listening again…";
  if (phase === "confirmed" && voice.status === "listening") return "Listening for changes…";
  if (phase === "presenting") return "YiYi is listening…";
  if (phase === "confirmed") return "Outfit decided · Tap to continue";
  return voice.status === "listening" ? "Listening…" : "Tap to talk";
}

function TodayPage() {
  const pagerRef = useRef<SwiperInstance | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const voiceSnapshot = useSyncExternalStore(voiceSessionCoordinator.subscribe, voiceSessionCoordinator.getSnapshot, voiceSessionServerSnapshot);
  const transcript = voiceSnapshot.owner === "today" ? voiceSnapshot.latestUserTranscript?.text ?? "" : "";
  const [resultTranscript, setResultTranscript] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [intent, setIntent] = useState<DailyIntent>(() => emptyDailyIntent());
  const [current, setCurrent] = useState<Outfit | null>(null);
  const [reason, setReason] = useState<string>(copy.outfit.reason);
  const [history, setHistory] = useState<Outfit[]>([]);
  const [focusedSlot, setFocusedSlot] = useState<OutfitSlot | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<IntentTag | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [weather, setWeather] = useState<WeatherContext | null>(null);
  const [weatherSource, setWeatherSource] = useState<WeatherSource | null>(null);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [activeVoiceAction, setActiveVoiceAction] = useState<VoiceTurnAction["action"] | null>(null);
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
      configureSounds(await getSoundEnabled());
      const [items, sessions, cachedState] = await Promise.all([
        getWardrobeItemsForCurrentMode(),
        db.dailySessions.where("dateKey").equals(localDateKey()).toArray(),
        getStoredWeatherState(),
      ]);
      const session = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (cancelled) return;
      const cachedWeather = usableCachedWeather(cachedState);
      const resolvedWeather = resolveWeatherForSession(null, session?.weather, cachedWeather);
      const resolvedSource = cachedWeather === resolvedWeather
        ? cachedState.source
        : configuredWeatherMode() === "fixed-demo" && resolvedWeather
          ? "fixed-demo"
          : resolvedWeather ? "open-meteo" : null;
      setWeather(resolvedWeather);
      setWeatherSource(resolvedSource);
      weatherRef.current = resolvedWeather;
      setWardrobe(items);
      wardrobeRef.current = items;
      setHydrated(true);
      // Local wardrobe/session/outfit hydration is the critical path. Location
      // permission and its timeout refresh weather independently afterward.
      void fetchConfiguredWeather().then(async (freshResult) => {
        if (cancelled || !freshResult?.weather) return;
        setWeather(freshResult.weather);
        setWeatherSource(freshResult.source);
        weatherRef.current = freshResult.weather;
        if (session && session.weather?.sourceTimestamp !== freshResult.weather.sourceTimestamp) {
          await db.dailySessions.update(session.id, { weather: freshResult.weather });
        }
      }).catch(() => undefined);
      if (session?.currentVersionId) {
        const version = await db.outfitVersions.get(session.currentVersionId);
        if (!cancelled && version) {
          const profile = (await db.preferenceProfiles.get("default")) ?? createNeutralPreferenceProfile();
          const validForCurrentContext = validateRestoredOutfit({ version, wardrobe: items, intent: session.intent, profile, weather: resolvedWeather }).valid;
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
    if (["connecting", "listening", "committing", "understanding", "tool_running", "revising", "speaking", "interrupted"].includes(voiceSnapshot.status)) resetInactivityTimer();
    if (voiceSnapshot.status === "connecting" && !currentRef.current) setPhase("connecting");
    if (voiceSnapshot.status === "listening") setPhase((value) => value === "confirmed" ? value : currentRef.current ? (value === "revising" ? value : "presenting") : "listening");
    if (voiceSnapshot.status === "committing" || voiceSnapshot.status === "understanding") setPhase((value) => currentRef.current ? value : "understanding");
    if (voiceSnapshot.status === "tool_running") setPhase((value) => currentRef.current ? value : "generating");
    if (voiceSnapshot.status === "revising") setPhase("revising");
    if (voiceSnapshot.status === "recoverable_error" || voiceSnapshot.status === "rate_limited") {
      operationControllerRef.current.cancel();
      setPhase(currentRef.current ? "paused" : "error");
    }
  // The coordinator snapshot is the only connection-state input; timer helpers use refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSnapshot.owner, voiceSnapshot.status]);

  useEffect(() => {
    const nextTranscript = voiceSnapshot.latestUserTranscript;
    if (voiceSnapshot.owner !== "today" || !nextTranscript || nextTranscript.role !== "user") return;
    queueMicrotask(() => setResultTranscript(nextTranscript.text));
    if (!nextTranscript.final) return;
    if (process.env.NEXT_PUBLIC_VOICE_MODE === "live") return;
    const key = `${voiceSnapshot.generation}:${nextTranscript.text}`;
    if (handledTranscriptRef.current === key) return;
    handledTranscriptRef.current = key;
    void (async () => {
      const request = await interpretBrowserVoiceTranscript(nextTranscript.text).catch(() => ({
        userRequest: nextTranscript.text,
        activityPhrases: [],
        desiredFeelings: [],
        exclusions: [],
        wardrobeAnchors: [],
      }));
      const nextIntent = buildDailyIntentFromVoiceRequest(request, wardrobeRef.current);
      void runRecommendation(nextIntent, nextTranscript.text);
    })();
    void voiceSessionCoordinator.stop("today", "user");
  // runRecommendation reads current refs and is intentionally triggered only by a new final browser transcript.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSnapshot.generation, voiceSnapshot.latestUserTranscript, voiceSnapshot.owner]);

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
    let failureStage: "recommendation" | "persistence" | "lifecycle" = "persistence";
    try {
      if (input.voiceGeneration !== undefined && !voiceSessionCoordinator.isCurrent("today", input.voiceGeneration)) {
        operationControllerRef.current.finish(token);
        return { success: false as const, summary: "That voice session has already ended." };
      }
      const items = await getWardrobeItemsForCurrentMode();
      const profile = (await db.preferenceProfiles.get("default")) ?? createNeutralPreferenceProfile();
      failureStage = "recommendation";
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
      failureStage = "persistence";
      const committed = await commitOutfitMutation({ sessionId, dateKey: localDateKey(), intent: decision.context.intent, weather: weatherRef.current, outfit: ranked.outfit, baseVersionId: token.baseVersionId, expectedGeneration, revisionRequest: before ? input.utterance : null });
      operationControllerRef.current.enterPublish(token);
      failureStage = "lifecycle";
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
      return {
        success: true as const,
        summary: input.operation === "targeted_revision" ? "Better. I kept every unmentioned piece." : input.operation === "random_new_outfit" ? "Here is a different legal answer for the same day." : input.operation === "global_revision" ? "This answer follows the new direction." : "I found one clear outfit for today.",
        ...outfitMutationProof(before, ranked.outfit),
        outfitVersionId: committed.versionId,
      };
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
      return {
        success: false as const,
        summary,
        failureStage,
        errorCode: error instanceof RecommendationError
          ? error.code
          : failureStage === "persistence"
            ? "OUTFIT_PERSISTENCE_FAILED"
            : failureStage === "lifecycle"
              ? "OUTFIT_PUBLISH_FAILED"
              : "RECOMMENDATION_FAILED",
      };
    }
  }

  const runRecommendation = (nextIntent: DailyIntent, utterance: string) => executeDecision({ operation: "initial", nextIntent, utterance });
  function recommendFromEditedTranscript(nextText: string) {
    setResultTranscript(nextText);
    void (async () => {
      const request = await interpretBrowserVoiceTranscript(nextText).catch(() => ({
        userRequest: nextText,
        activityPhrases: [],
        desiredFeelings: [],
        exclusions: [],
        wardrobeAnchors: [],
      }));
      const nextIntent = buildDailyIntentFromVoiceRequest(request, wardrobeRef.current);
      void runRecommendation(nextIntent, nextText);
    })();
  }
  const revise = (slot: OutfitSlot = "bag", request = `Choose another ${slot}.`) => executeDecision({ operation: "targeted_revision", delta: targetedDelta(slot, request), utterance: request });
  const randomizeOutfit = () => executeDecision({ operation: "random_new_outfit", delta: randomDelta(), utterance: "Choose a different outfit for the same day." });

  async function undo(voiceGeneration?: number) {
    const baseVersionId = versionIdRef.current;
    const sessionId = sessionIdRef.current;
    if (!baseVersionId || !sessionId) return false;
    let token;
    try { token = operationControllerRef.current.begin(baseVersionId); } catch { return false; }
    try {
      const [items, profile] = await Promise.all([getWardrobeItemsForCurrentMode(), db.preferenceProfiles.get("default")]);
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
      const items = await getWardrobeItemsForCurrentMode();
      const context = createRecommendationContext({ wardrobe: items, intent: intentRef.current, profile, weather: weatherRef.current, currentOutfit: outfit, operation: "initial" });
      assertDisplayedOutfitLegal(outfit, context);
      const updatedProfile = updateProfileFromOutfitFeedback({ profile, outfit, wardrobe: items, kind: "confirmed", intent: intentRef.current, contextId: sessionId });
      if (voiceGeneration !== undefined && !voiceSessionCoordinator.isCurrent("today", voiceGeneration)) {
        operationControllerRef.current.finish(token);
        return { success: false as const, summary: "That voice session has already ended." };
      }
      const session = await runCommitPhase(operationControllerRef.current, token, () => confirmOutfitMutation({ sessionId, baseVersionId, expectedGeneration: operationGenerationRef.current, outfit, updatedProfile }));
      operationGenerationRef.current = session.operationGeneration;
      setPhase("confirmed");
      operationControllerRef.current.finish(token);
      return { success: true as const, summary: "Outfit decided. I’ll stay available for changes.", changedSlots: [], removedItemIds: [], addedItemIds: [], outfitVersionId: baseVersionId };
    } catch { operationControllerRef.current.finish(token); setPhase("presenting"); return { success: false as const, summary: "The outfit changed before it could be confirmed." }; }
  }

  function createHandlers(voiceGeneration: number): VoiceToolHandlers {
    const currentVoice = () => voiceSessionCoordinator.isCurrent("today", voiceGeneration);
    const staleVoice = () => ({ success: false, summary: "That voice session has already ended." });
    return {
      requestRecommendation: (request) => {
        if (!currentVoice()) return Promise.resolve(staleVoice());
        const nextIntent = buildDailyIntentFromVoiceRequest(request, wardrobeRef.current);
        return executeDecision({ operation: "initial", nextIntent, utterance: request.userRequest, voiceGeneration });
      },
      handleTurn: async (input) => {
        if (!currentVoice()) return staleVoice();
        setActiveVoiceAction(input.action);
        try {
        if (input.action === "no_change") return { success: true, summary: "I’m listening when you’re ready.", changedSlots: [], removedItemIds: [], addedItemIds: [], outfitVersionId: versionIdRef.current ?? undefined };
        if (input.action === "confirm") return await confirmCurrent(voiceGeneration);
        if (input.action === "undo") {
          const before = currentRef.current;
          const success = await undo(voiceGeneration);
          const after = currentRef.current;
          return success && after
            ? { success: true, summary: "I restored the previous outfit.", ...outfitMutationProof(before, after), outfitVersionId: versionIdRef.current ?? undefined }
            : { success: false, summary: currentVoice() ? "There is no previous outfit to restore." : "That voice session has already ended.", errorCode: "UNDO_UNAVAILABLE", failureStage: "persistence" };
        }
        if (input.action === "random") return await executeDecision({ operation: "random_new_outfit", delta: randomDelta(), utterance: input.userRequest, voiceGeneration });
        if (input.action === "save_preference") return { success: false, summary: "Please add lasting preferences in Fine-tune so you can review them.", errorCode: "PREFERENCE_REVIEW_REQUIRED", failureStage: "tool" };
        if (input.action === "set_availability") {
          if (!input.availability) return { success: false, summary: "Tell me whether that item is available, in laundry, or unavailable.", errorCode: "AVAILABILITY_REQUIRED", failureStage: "tool" };
          let token: OperationToken;
          try { token = operationControllerRef.current.begin(versionIdRef.current); }
          catch { return { success: false, summary: "I’m still finishing the previous outfit change." }; }
          try {
            const targetSlot = input.targetSlot ?? focusedSlotRef.current;
            const focusedItemId = targetSlot ? currentRef.current?.itemIds[targetSlot] ?? null : null;
            const itemId = resolveAvailabilityItemId(null, focusedItemId);
            if (!itemId) { operationControllerRef.current.finish(token); return { success: false, summary: "Tap the item you mean, then tell me its availability again." }; }
            if (!currentVoice()) { operationControllerRef.current.finish(token); return staleVoice(); }
            operationControllerRef.current.enterCommit(token);
            const items = await updateItemAvailabilityMutation({ itemId, availability: input.availability, reason: input.userRequest });
            if (!items) { operationControllerRef.current.finish(token); return { success: false, summary: "I could not find that wardrobe item." }; }
            if (currentRef.current && Object.values(currentRef.current.itemIds).includes(itemId) && input.availability !== "available") {
              const delta = IntentDeltaSchema.parse({ operation: "global_revision", targetSlots: [], preserveSlots: [], emptySlots: [], requiredItemIds: [], excludedItemIds: [itemId], excludedCategories: [], adjustments: zeroAdjustments, desiredStyleTags: [], undesiredStyleTags: [], rawUtterance: input.userRequest, confidence: 1, ambiguity: [] });
              return await executeDecision({ operation: "global_revision", delta, utterance: delta.rawUtterance, operationToken: token, clearInvalidCurrentOnFailure: true });
            }
            operationControllerRef.current.enterPublish(token);
            setWardrobe(items);
            wardrobeRef.current = items;
            operationControllerRef.current.finish(token);
            return { success: true, summary: "I updated that item.", changedSlots: [], removedItemIds: [], addedItemIds: [], outfitVersionId: versionIdRef.current ?? undefined };
          } catch {
            operationControllerRef.current.finish(token);
            return { success: false, summary: "I could not safely update that item.", errorCode: "AVAILABILITY_UPDATE_FAILED", failureStage: "persistence" };
          }
        }
        const outfit = currentRef.current;
        if (!outfit) return { success: false, summary: "There is no current outfit to revise.", errorCode: "OUTFIT_REQUIRED", failureStage: "lifecycle" };
        const delta = voiceActionToIntentDelta({ action: input, currentOutfit: outfit, wardrobe: wardrobeRef.current, focusedSlot: focusedSlotRef.current });
        if (input.action === "remove" && !delta.targetSlots.length) return { success: false, summary: "Tap or name the item you want removed.", errorCode: "REVISION_TARGET_REQUIRED", failureStage: "tool" };
        if (delta.emptySlots?.length && delta.emptySlots.every((slot) => !outfit.itemIds[slot])) {
          return { success: true, summary: "That item is already out of this outfit.", changedSlots: [], removedItemIds: [], addedItemIds: [], outfitVersionId: versionIdRef.current ?? undefined };
        }
        return await executeDecision({ operation: delta.operation === "targeted_revision" ? "targeted_revision" : "global_revision", delta, utterance: input.userRequest, voiceGeneration });
        } finally {
          if (currentVoice()) setActiveVoiceAction(null);
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
    if (!hydrated || operationControllerRef.current.isBusy() || ["connecting", "listening", "committing", "understanding", "tool_running", "revising", "speaking", "interrupted"].includes(connection.status)) return;
    const resumeExisting = Boolean(currentRef.current);
    await unlockSounds();
    playSound("listen");
    if (!resumeExisting) setPhase("connecting");
    const autoMock = typeof window !== "undefined" && localStorage.getItem("yiyi:test-auto-voice") === "true";
    lifetimeTimerRef.current = window.setTimeout(() => void disconnectVoice(currentRef.current ? "paused" : "idle"), 300_000);
    resetInactivityTimer();
    try {
      await voiceSessionCoordinator.start("today", ({ attemptId, generation }) => process.env.NEXT_PUBLIC_VOICE_MODE === "live"
        ? new OpenAIRealtimeVoiceAdapter(createHandlers(generation), { attemptId, sessionGeneration: generation, purpose: "today", requireInitialRecommendation: !resumeExisting })
        : process.env.NEXT_PUBLIC_VOICE_MODE === "browser"
          ? new BrowserPreferenceVoiceAdapter()
          : new MockVoiceSessionAdapter(autoMock && !resumeExisting));
    } catch {
      clearSessionTimers();
      setPhase(currentRef.current ? "paused" : "error");
    }
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
  const activeVoice = voiceSnapshot.owner === "today" && ["connecting", "listening", "committing", "understanding", "tool_running", "revising", "speaking", "interrupted"].includes(voiceSnapshot.status);
  const visualState = voiceVisualState(phase, voiceSnapshot.status, activeVoiceAction);
  const status = voiceStatus(phase, voiceSnapshot, activeVoiceAction);
  const isMock = process.env.NEXT_PUBLIC_VOICE_MODE !== "live" && process.env.NEXT_PUBLIC_VOICE_MODE !== "browser";
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
          <button className="weather-pill" type="button" disabled={!weather} aria-expanded={weatherOpen} aria-controls="today-weather-panel" onClick={() => setWeatherOpen((open) => !open)}>
            {weather ? `${temperatureLabel(weather.currentTemperatureC ?? weather.minApparentTempC)} · ${weather.summary}${weatherSource === "fixed-demo" ? " · Demo" : ""}` : "Weather unavailable"}
          </button>
          <Link className="icon-button" href="/settings" aria-label="Open settings"><Settings size={20} /></Link>
        </header>
        <AnimatePresence>{weatherOpen && weather && <WeatherPanel weather={weather} source={weatherSource} onClose={() => setWeatherOpen(false)} />}</AnimatePresence>
        <div className="today-stage">
          <AnimatePresence initial={false} mode="popLayout">
            {phase === "idle" && <Idle key="idle" hydrated={hydrated} recoveryMessage={recoveryMessage} />}
            {["connecting", "listening", "understanding", "generating"].includes(phase) && <Listening key="listening" phase={phase} transcript={transcript} tags={tags} onEditTag={(tag) => { setEditingTag(tag); setTagDraft(tag.label); }} isMock={isMock} onUseDemo={() => voiceSessionCoordinator.submitDemoTurn("today")} />}
            {(phase === "presenting" || phase === "revising") && current && <Result key="result" current={current} wardrobe={wardrobe} reason={reason} phase={phase} tags={tags} transcript={resultTranscript} liveTranscript={voiceSnapshot.latestUserTranscript?.final === false ? transcript : ""} focusedSlot={focusedSlot} onFocus={setFocusedSlot} onOpenDetails={() => setDetailsOpen(true)} onRevise={revise} onUndo={() => void undo()} canUndo={history.length > 0} onRandom={() => void randomizeOutfit()} onConfirm={() => void confirmCurrent()} />}
            {phase === "paused" && <Paused key="paused" current={current} wardrobe={wardrobe} hasDetails={Boolean(transcript || resultTranscript || tags.length)} onOpenDetails={() => setDetailsOpen(true)} />}
            {phase === "confirmed" && current && <Confirmed key="confirmed" current={current} wardrobe={wardrobe} onRevise={() => setPhase("presenting")} onOpenWardrobe={() => pagerRef.current?.slideTo(1)} />}
            {phase === "error" && <ErrorState key="error" hasDetails={Boolean(transcript || resultTranscript || tags.length)} onOpenDetails={() => setDetailsOpen(true)} />}
          </AnimatePresence>
        </div>
        <VoiceDock
          state={visualState}
          status={status}
          active={activeVoice}
          disabled={!hydrated}
          onPrimary={() => {
            if (voiceSnapshot.owner === "today" && voiceSnapshot.status === "listening") voiceSessionCoordinator.commitTurn("today");
            else if (voiceSnapshot.owner === "today" && voiceSnapshot.status === "speaking") voiceSessionCoordinator.interruptAndListen("today");
            else void startSession();
          }}
        />
        <BottomSheet open={detailsOpen} onClose={() => setDetailsOpen(false)} label="Today details" className="today-details-sheet">
          <TodayDetails
            transcript={resultTranscript || transcript}
            tags={tags}
            onEditTranscript={(text) => { setDetailsOpen(false); recommendFromEditedTranscript(text); }}
            onEditTag={(tag) => { setDetailsOpen(false); setEditingTag(tag); setTagDraft(tag.label); }}
          />
        </BottomSheet>
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
  return <MotionSection className="today-content today-idle"><div className="today-morning-mark"><span>{hydrated ? "Ready for your day" : "Opening your wardrobe…"}</span></div><div className="today-idle-copy"><h1>{copy.today.prompt}</h1><p>{recoveryMessage ?? "Describe where you’re going, how you want to feel, and what the day needs."}</p><span>“{copy.today.example}”</span></div><div className="dock-spacer" /></MotionSection>;
}

function temperatureLabel(celsius: number) {
  return `${Math.round((celsius * 9) / 5 + 32)}°`;
}

function WeatherPanel({ weather, source, onClose }: { weather: WeatherContext; source: WeatherSource | null; onClose: () => void }) {
  const reduceMotion = useReducedMotionConfig();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="weather-panel-layer"><motion.button className="weather-panel-scrim" aria-label="Close weather" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} /><motion.section id="today-weather-panel" role="dialog" aria-label="Weather details" className="weather-panel swiper-no-swiping" drag={reduceMotion ? false : "y"} dragConstraints={{ top: -90, bottom: 0 }} dragElastic={{ top: 0.2, bottom: 0 }} onDragEnd={(_, info) => { if (info.offset.y < -48 || info.velocity.y < -420) onClose(); }} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: .99 }} transition={reduceMotion ? { duration: .12 } : calmSpring}>
    <div className="weather-panel-heading"><div><span>{weather.locationLabel ?? "Current area"}{source === "fixed-demo" ? " · Demo" : ""}</span><strong>{temperatureLabel(weather.currentTemperatureC ?? weather.minApparentTempC)} · {weather.summary}</strong></div><span>H {temperatureLabel(weather.dailyHighC ?? weather.maxApparentTempC)} · L {temperatureLabel(weather.dailyLowC ?? weather.minApparentTempC)}</span></div>
    <div className="weather-hourly" aria-label="Hourly weather forecast">{(weather.hourly ?? []).map((hour) => <div key={hour.timestamp}><time>{new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: weather.timezone }).format(hour.timestamp)}</time><strong>{temperatureLabel(hour.temperatureC)}</strong><span>{hour.precipitationProbability}% rain</span></div>)}</div>
    <p>Updated {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(weather.sourceTimestamp)}</p>
  </motion.section></div>;
}

function Listening({ phase, transcript, tags, onEditTag, isMock, onUseDemo }: { phase: Phase; transcript: string; tags: IntentTag[]; onEditTag: (tag: IntentTag) => void; isMock: boolean; onUseDemo: () => void }) {
  const reduceMotion = useReducedMotionConfig();
  const showTranscript = phase === "listening" || phase === "connecting";
  const timeline = phase === "connecting" ? 0 : phase === "listening" ? 1 : phase === "understanding" ? 2 : 3;
  return <MotionSection className="today-content session-content"><div className="session-timeline" aria-label="Voice progress"><span className={timeline >= 1 ? "active" : ""}>Listening</span><i /><span className={timeline >= 2 ? "active" : ""}>Understanding</span><i /><span className={timeline >= 3 ? "active" : ""}>Choosing</span></div><div className="session-focus"><AnimatePresence mode="wait">{showTranscript ? <motion.div key="transcript" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(-4px)" }}><p className="eyebrow">Your day</p><h1 className="live-transcript">{transcript ? `“${transcript}”` : "I’m listening. Take your time."}</h1>{isMock && phase === "listening" && <button className="demo-turn-button" onClick={onUseDemo}>Continue with the demo day</button>}</motion.div> : <motion.div key="intent" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(7px)" }} animate={{ opacity: 1, transform: "translateY(0)" }}><p className="eyebrow">What YiYi understood</p><LayoutGroup id="today-intent-tags"><motion.div className="chip-row understood-tags" layout><AnimatePresence initial={false} mode="popLayout">{tags.map((tag) => <motion.button className="chip" layout key={tag.id} onClick={() => onEditTag(tag)} initial={{ opacity: 0, transform: "scale(.97)" }} animate={{ opacity: 1, transform: "scale(1)" }} exit={{ opacity: 0, transform: "scale(.97)" }} transition={{ duration: reduceMotion ? .1 : .18, ease: [.23, 1, .32, 1] }}>{tag.label}</motion.button>)}</AnimatePresence></motion.div></LayoutGroup></motion.div>}</AnimatePresence></div><div className="dock-spacer" /></MotionSection>;
}

type ResultProps = { current: Outfit; wardrobe: WardrobeItem[]; reason: string; phase: "presenting" | "revising"; tags: IntentTag[]; transcript: string; liveTranscript: string; focusedSlot: OutfitSlot | null; onFocus: (slot: OutfitSlot) => void; onOpenDetails: () => void; onRevise: (slot?: OutfitSlot) => void; onUndo: () => void; canUndo: boolean; onRandom: () => void; onConfirm: () => void };

function Result({ current, wardrobe, reason, phase, tags, transcript, liveTranscript, focusedSlot, onFocus, onOpenDetails, onRevise, onUndo, canUndo, onRandom, onConfirm }: ResultProps) {
  const reduceMotion = useReducedMotionConfig();
  const mutationLocked = phase === "revising";
  return <MotionSection className="today-content result-section"><header className="result-heading"><p className="eyebrow">Today’s answer</p><h1>{copy.outfit.main}</h1><div className="result-supporting-copy"><AnimatePresence initial={false} mode="wait">{liveTranscript ? <motion.p key="live" role="status" aria-label="Live voice feedback" className="result-live-feedback" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? .1 : .18 }}><span>Listening</span> “{liveTranscript}”</motion.p> : <motion.p key={reason} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? .1 : .18 }}>{reason}</motion.p>}</AnimatePresence></div></header><div className="single-outfit-stage"><AnimatePresence initial={false}>{phase === "revising" && <motion.div className="revision-bubble" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(5px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>Keeping every unmentioned piece still.</motion.div>}</AnimatePresence><OutfitCanvas outfit={current} wardrobe={wardrobe} onSelect={mutationLocked ? undefined : onFocus} emphasizedSlot={phase === "revising" ? focusedSlot : null} /></div><AnimatePresence initial={false} mode="popLayout">{focusedSlot && <motion.div className="focused-item" key={focusedSlot} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(6px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} exit={{ opacity: 0 }} transition={{ duration: .18 }}><span>Revise this {focusedSlot === "extraAccessory" ? "accessory" : focusedSlot}</span><SecondaryButton disabled={mutationLocked} onClick={() => onRevise(focusedSlot)}>Replace</SecondaryButton></motion.div>}</AnimatePresence><div className="result-actions"><div className="result-command-row">{(transcript || tags.length > 0) && <button className="result-details-trigger" type="button" aria-label="Open today details" onClick={onOpenDetails}>Details <span aria-hidden="true">›</span></button>}{canUndo && <button disabled={mutationLocked} onClick={onUndo}><Undo2 size={16} />Undo</button>}<button disabled={mutationLocked} onClick={onRandom}><Shuffle size={16} />Another</button></div><PrimaryButton className="wear-button" disabled={mutationLocked} onClick={onConfirm}><Check size={17} />{copy.outfit.wear}</PrimaryButton></div><div className="dock-spacer compact" /></MotionSection>;
}

function Paused({ current, wardrobe, hasDetails, onOpenDetails }: { current: Outfit | null; wardrobe: WardrobeItem[]; hasDetails: boolean; onOpenDetails: () => void }) {
  return <MotionSection className="today-content paused-state"><div>{current ? <div className="paused-outfit"><OutfitCanvas outfit={current} wardrobe={wardrobe} /></div> : <VoiceCore state="idle" label="YiYi voice paused" />}<h1>Session paused.</h1><p>Your outfit and understanding are still here. Tap the Voice Dock to reconnect.</p>{hasDetails && <button className="result-details-trigger" type="button" onClick={onOpenDetails}>Today details <span aria-hidden="true">›</span></button>}</div><div className="dock-spacer" /></MotionSection>;
}

function Confirmed({ current, wardrobe, onRevise, onOpenWardrobe }: { current: Outfit; wardrobe: WardrobeItem[]; onRevise: () => void; onOpenWardrobe: () => void }) {
  return <MotionSection className="today-content confirmed-state"><YiYiMarkWithAccent /><h1>{copy.outfit.confirmedTitle}</h1><p>{copy.outfit.confirmedBody}</p><div className="confirmed-outfit"><OutfitCanvas outfit={current} wardrobe={wardrobe} /></div><div className="confirmed-actions"><PrimaryButton onClick={onRevise}>See today’s outfit</PrimaryButton><button type="button" onClick={onOpenWardrobe} className="secondary-button">Open wardrobe</button></div><div className="dock-spacer compact" /></MotionSection>;
}

function YiYiMarkWithAccent() { return <div className="confirmed-mark"><VoiceCore state="idle" label="Outfit decided" /><span /><span /></div>; }

function IntentTagSheet({ tag, value, onChange, onSave, onRemove }: { tag: IntentTag; value: string; onChange: (value: string) => void; onSave: () => void; onRemove: () => void }) {
  return <><h2>Edit today’s intent</h2><p className="secondary-copy">This changes today only and creates one refreshed answer.</p>{tag.kind !== "excluded" && <input className="sheet-input" aria-label="Intent tag" value={value} onChange={(event) => onChange(event.target.value)} />}<div className="sheet-actions"><SecondaryButton onClick={onRemove}>{tag.kind === "excluded" ? "Allow this today" : "Remove tag"}</SecondaryButton>{tag.kind !== "excluded" && <PrimaryButton disabled={!value.trim()} onClick={onSave}>Update outfit</PrimaryButton>}</div></>;
}

function TodayDetails({ transcript, tags, onEditTranscript, onEditTag }: { transcript: string; tags: IntentTag[]; onEditTranscript: (text: string) => void; onEditTag: (tag: IntentTag) => void }) {
  return <div className="today-details"><h2>Today details</h2><p className="secondary-copy">A quiet place to review what shaped this outfit.</p>{transcript && <EditableVoiceTranscript text={transcript} onCommit={onEditTranscript} onCancel={() => undefined} />}{tags.length > 0 && <section className="today-details-intent"><h3>What YiYi understood</h3><div className="chip-row">{tags.map((tag) => <button type="button" className="chip" key={tag.id} onClick={() => onEditTag(tag)}>{tag.label}</button>)}</div></section>}</div>;
}

function ErrorState({ hasDetails, onOpenDetails }: { hasDetails: boolean; onOpenDetails: () => void }) {
  return <MotionSection className="today-content error-state"><div><VoiceCore state="error" label="YiYi voice error" /><h1>YiYi couldn’t finish that.</h1><p>Your wardrobe is safe. Tap the Voice Dock to try again.</p>{hasDetails && <button className="result-details-trigger" type="button" onClick={onOpenDetails}>Review today’s details <span aria-hidden="true">›</span></button>}</div><div className="dock-spacer" /></MotionSection>;
}

export default TodayPage;
