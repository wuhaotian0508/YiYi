"use client";

import Image from "next/image";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotionConfig } from "motion/react";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";
import {
  createCalibrationResponse,
  deriveCalibrationModel,
  upsertCalibrationResponse,
} from "@/domain/preferences/calibration-engine";
import type {
  CalibrationResponse,
  CalibrationResponseChoice,
  CalibrationPresentationOrder,
  PreferenceProfile,
  PreferenceSignal,
  WardrobeDirection,
} from "@/domain/schemas";
import styles from "./onboarding-calibration.module.css";

const BASE_QUESTION_COUNT = 4;
const FOLLOW_UP_CONFIDENCE_THRESHOLD = 0.45;

function needsFollowUp(responses: readonly CalibrationResponse[]) {
  return deriveCalibrationModel(responses).confidence.overall < FOLLOW_UP_CONFIDENCE_THRESHOLD;
}

function progressLabel(questionIndex: number) {
  return questionIndex < BASE_QUESTION_COUNT
    ? `${questionIndex + 1} of ${BASE_QUESTION_COUNT}`
    : `Optional ${questionIndex - BASE_QUESTION_COUNT + 1} of 2`;
}

function hasResponse(questionIndex: number, responses: readonly CalibrationResponse[]) {
  return responses.some((response) => response.questionId === calibrationCatalogV2.questions[questionIndex]?.id);
}

function hasConsecutiveSkips(questionIndex: number, responses: readonly CalibrationResponse[]) {
  if (questionIndex < 1) return false;
  return [questionIndex - 1, questionIndex].every((index) => responses.some((response) => (
    response.questionId === calibrationCatalogV2.questions[index]?.id && response.choice === "skip"
  )));
}

function nextResponseTimestamp(responses: readonly CalibrationResponse[]) {
  return Math.max(Date.now(), ...responses.map((response) => response.createdAt + 1));
}

function nextQuestionIndex(questionIndex: number, responses: readonly CalibrationResponse[]) {
  if (questionIndex < BASE_QUESTION_COUNT - 1) return questionIndex + 1;
  if (questionIndex === BASE_QUESTION_COUNT - 1) {
    return hasResponse(BASE_QUESTION_COUNT, responses) || needsFollowUp(responses) ? BASE_QUESTION_COUNT : null;
  }
  if (questionIndex === BASE_QUESTION_COUNT) {
    return hasResponse(BASE_QUESTION_COUNT + 1, responses) || needsFollowUp(responses) ? BASE_QUESTION_COUNT + 1 : null;
  }
  return null;
}

export function lastAnsweredCalibrationIndex(responses: readonly CalibrationResponse[]) {
  const mostRecent = [...responses].sort((left, right) => right.createdAt - left.createdAt)[0];
  if (!mostRecent) return 0;
  return Math.max(0, calibrationCatalogV2.questions.findIndex((question) => question.id === mostRecent.questionId));
}

export function removeLastCalibrationAnswer(responses: readonly CalibrationResponse[]) {
  const mostRecent = [...responses].sort((left, right) => right.createdAt - left.createdAt)[0];
  return mostRecent ? responses.filter((response) => response.id !== mostRecent.id) : [...responses];
}

type OnboardingCalibrationProps = {
  questionIndex: number;
  responses: CalibrationResponse[];
  onQuestionIndexChange: (index: number) => void;
  onResponses: (responses: CalibrationResponse[]) => void;
  onBack: () => void;
  onFinish: () => void;
};

export function OnboardingCalibration({
  questionIndex,
  responses,
  onQuestionIndexChange,
  onResponses,
  onBack,
  onFinish,
}: OnboardingCalibrationProps) {
  const reduceMotion = useReducedMotionConfig();
  const question = calibrationCatalogV2.questions[questionIndex];
  const currentResponse = responses.find((response) => response.questionId === question.id);
  const currentChoice = currentResponse?.choice;
  // The catalog IDs remain canonical persisted values. Formal onboarding uses a
  // stable presentation so internal counterbalancing never appears as B/A UI.
  const presentationOrder: CalibrationPresentationOrder = ["a", "b"];
  const presentedOptions = presentationOrder.map((canonicalId) => ({
    canonicalId,
    option: canonicalId === "a" ? question.optionA : question.optionB,
  }));
  const presentationAlt = `${presentedOptions[0].option.label} beside ${presentedOptions[1].option.label}, shown on matching mannequins`;

  function answer(choice: CalibrationResponseChoice) {
    const createdAt = nextResponseTimestamp(responses);
    const nextResponses = upsertCalibrationResponse(
      responses,
      createCalibrationResponse(question.id, choice, createdAt, calibrationCatalogV2, presentationOrder),
    );
    onResponses(nextResponses);
    if (hasConsecutiveSkips(questionIndex, nextResponses)) {
      onFinish();
      return;
    }
    const nextIndex = nextQuestionIndex(questionIndex, nextResponses);
    if (nextIndex === null) onFinish();
    else onQuestionIndexChange(nextIndex);
  }

  function back() {
    if (questionIndex === 0) onBack();
    else onQuestionIndexChange(questionIndex - 1);
  }

  return <div className={styles.flow}>
    <div className={styles.topbar}>
      <button className={styles.iconButton} onClick={back} aria-label="Back"><ArrowLeft size={20} /></button>
      <span className={styles.topbarTitle}>Your taste</span>
      <button className={styles.finishButton} onClick={onFinish}>Finish for now</button>
    </div>

    <motion.div
      className={styles.questionStage}
      key={question.id}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateX(5px)" }}
      animate={{ opacity: 1, transform: "translateX(0)" }}
      transition={{ duration: reduceMotion ? .12 : .2, ease: [.23, 1, .32, 1] }}
    >
        <header className={styles.heading}>
          <span className={styles.progress}>{progressLabel(questionIndex)}</span>
          <h1>{question.prompt}</h1>
          <p>Choose what you would wear. Judge the outfit, not the image.</p>
        </header>

        <div className={styles.board}>
          {presentedOptions.map(({ canonicalId }, position) => <Image
            key={`${question.id}-${canonicalId}`}
            className={styles.boardImage}
            data-source-option={canonicalId}
            data-presentation-position={position === 0 ? "left" : "right"}
            src={question.asset.src}
            alt={position === 0 ? presentationAlt : ""}
            fill
            sizes="(max-width: 480px) calc(100vw - 40px), 390px"
            loading="eager"
            priority={questionIndex === 0 && position === 0}
          />)}
          <span className={styles.divider} aria-hidden="true" />
        </div>

        <div className={styles.optionLabels} aria-hidden="true">
          {presentedOptions.map(({ canonicalId, option }) => <span data-calibration-option key={canonicalId}><b>{canonicalId.toUpperCase()}</b>{option.label}</span>)}
        </div>

        <div className={styles.choices}>
          {presentedOptions.map(({ canonicalId }) => <button key={canonicalId} aria-pressed={currentChoice === canonicalId} onClick={() => answer(canonicalId)}>{canonicalId.toUpperCase()} feels like me</button>)}
          <button aria-pressed={currentChoice === "both"} onClick={() => answer("both")}>Both</button>
          <button aria-pressed={currentChoice === "neither"} onClick={() => answer("neither")}>Neither</button>
          <button className={styles.skip} aria-pressed={currentChoice === "skip"} onClick={() => answer("skip")}>Skip</button>
        </div>
    </motion.div>
  </div>;
}

function activeLabels(signals: readonly PreferenceSignal[], polarity: PreferenceSignal["polarity"]) {
  return [...new Set(signals
    .filter((signal) => signal.status === "active" && signal.polarity === polarity)
    .map((signal) => signal.label))];
}

function reviewLabels(signals: readonly PreferenceSignal[]) {
  return [...new Set(signals.filter((signal) => signal.status === "needs_review").map((signal) => signal.label))];
}

function SignalList({ labels, empty }: { labels: string[]; empty: string }) {
  if (labels.length === 0) return <p className={styles.emptySignal}>{empty}</p>;
  return <LayoutGroup><motion.div className={styles.signalChips} layout><AnimatePresence initial={false} mode="popLayout">{labels.map((label) => <motion.span key={label} layout initial={{ opacity: 0, transform: "scale(.98)" }} animate={{ opacity: 1, transform: "scale(1)" }} exit={{ opacity: 0, transform: "scale(.98)" }} transition={{ duration: .16, ease: [.23, 1, .32, 1] }}>{label}</motion.span>)}</AnimatePresence></motion.div></LayoutGroup>;
}

const directionLabels: Record<WardrobeDirection, string> = {
  womenswear: "Womenswear",
  menswear: "Menswear",
  mixed: "Across womenswear and menswear",
  neutral: "No wardrobe label",
};

type CalibrationProfileReviewProps = {
  direction: WardrobeDirection;
  profile: PreferenceProfile;
  canUndo: boolean;
  disabled?: boolean;
  onBack: () => void;
  onEdit: () => void;
  onUndo: () => void;
  onNext: () => void;
};

export function CalibrationProfileReview({
  direction,
  profile,
  canUndo,
  disabled = false,
  onBack,
  onEdit,
  onUndo,
  onNext,
}: CalibrationProfileReviewProps) {
  const signals = profile.preferenceSignals ?? [];
  const more = activeLabels(signals, "more");
  const less = activeLabels(signals, "less");
  const unknown = activeLabels(signals, "unknown");
  const needsReview = reviewLabels(signals);
  const confidence = Math.round((profile.profileConfidence?.overall ?? 0) * 100);
  const evidenceCount = (profile.calibrationResponses ?? []).filter((response) => response.choice !== "skip").length;

  return <div className={styles.profile}>
    <div className={styles.profileTopbar}>
      <button className={styles.iconButton} disabled={disabled} onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button>
      <YiYiMark size={37} />
      <button className={styles.editButton} disabled={disabled} onClick={onEdit}>Edit comparisons</button>
    </div>
    <header className={styles.profileHeading}>
      <h1>Your style so far</h1>
      <p>A starting point, not a permanent label. Everything stays editable.</p>
    </header>
    <div className={styles.profileScroll}>
      <section className={styles.profileMeta}>
        <div><span>Wardrobe description</span><strong>{directionLabels[direction]}</strong></div>
        <div><span>Learning confidence</span><strong>{confidence}% starting confidence</strong><small>{evidenceCount} answered comparison{evidenceCount === 1 ? "" : "s"}; skips add no evidence.</small></div>
      </section>
      <section className={styles.signalSection}>
        <h2>More of</h2>
        <SignalList labels={more} empty="Open to suggestions." />
      </section>
      <section className={styles.signalSection}>
        <h2>Less of</h2>
        <SignalList labels={less} empty="Nothing yet — YiYi will not invent dislikes." />
      </section>
      <section className={styles.signalSection}>
        <h2>Still open</h2>
        <SignalList labels={unknown} empty="No undecided comparisons yet." />
      </section>
      {needsReview.length > 0 && <section className={styles.signalSection}>
        <h2>Needs your review</h2>
        <SignalList labels={needsReview} empty="" />
      </section>}
    </div>
    <div className={styles.profileActions}>
      {canUndo && <button className={styles.undoButton} disabled={disabled} onClick={onUndo}><RotateCcw size={15} /> Undo last answer</button>}
      <PrimaryButton disabled={disabled} onClick={onNext}>Looks right</PrimaryButton>
      <SecondaryButton disabled={disabled} onClick={onBack}>Back and adjust</SecondaryButton>
    </div>
  </div>;
}
