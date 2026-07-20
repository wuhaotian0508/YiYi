"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import {
  buildCalibrationPreferenceProfile,
  createCalibrationResponse,
  upsertCalibrationResponse,
} from "@/domain/preferences/calibration-engine";
import { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";
import { buildPreferenceProfile } from "@/domain/preferences/calibration";
import { createNeutralPreferenceProfile } from "@/domain/preferences/defaults";
import { runRecommendationDecision } from "@/domain/recommendation/engine";
import type { CalibrationPresentationOrder, CalibrationResponse, CalibrationResponseChoice, StyleFeedback, WardrobeDirection } from "@/domain/schemas";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";
import styles from "./calibration-lab.module.css";

type Method = "pairwise" | "legacy-single";
type Material = "controlled" | "legacy-model";
type Presentation = "a-left" | "b-left";

const directions: { id: WardrobeDirection; label: string }[] = [
  { id: "neutral", label: "No preference" },
  { id: "womenswear", label: "Womenswear" },
  { id: "menswear", label: "Menswear" },
  { id: "mixed", label: "Across both" },
];

const legacyPairs = [[0, 1], [2, 3], [5, 4], [1, 0], [0, 3], [2, 4]] as const;
const legacyFeedbackChoices = ["like", "dislike", "skip"] as const;

function legacyLookStyle(index: number, direction: WardrobeDirection) {
  const menswear = direction === "menswear" || (direction === "mixed" && index % 2 === 1) || (direction === "neutral" && index >= 3);
  return {
    backgroundImage: `url('/style-calibration/${menswear ? "style-grid-menswear.webp" : "style-grid.webp"}')`,
    backgroundSize: "300% 200%",
    backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 100}%`,
  };
}

function axisFill(value: number) {
  const width = Math.abs(value) * 50;
  return value >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` };
}

function PairBoard({ questionIndex, material, direction, presentationOrder }: { questionIndex: number; material: Material; direction: WardrobeDirection; presentationOrder: CalibrationPresentationOrder }) {
  const question = calibrationCatalogV2.questions[questionIndex];
  const presentedOptions = presentationOrder.map((canonicalId) => ({
    canonicalId,
    option: canonicalId === "a" ? question.optionA : question.optionB,
  }));
  if (material === "controlled") {
    const alt = `${presentedOptions[0].option.label} beside ${presentedOptions[1].option.label}, shown on matching faceless mannequins`;
    return <div className={styles.board}>{presentedOptions.map(({ canonicalId }, position) => <Image
      key={canonicalId}
      className={styles.boardImage}
      data-source-option={canonicalId}
      data-presentation-position={position === 0 ? "left" : "right"}
      src={question.asset.src}
      alt={position === 0 ? alt : ""}
      fill
      sizes="(max-width: 820px) 100vw, 55vw"
      loading="eager"
      priority={position === 0}
    />)}<span className={styles.boardDivider} /></div>;
  }
  const canonicalSources = { a: legacyPairs[questionIndex][0], b: legacyPairs[questionIndex][1] };
  const [left, right] = presentationOrder.map((canonicalId) => canonicalSources[canonicalId]);
  return <div className={`${styles.board} ${styles.legacyPair}`} aria-label="Legacy model-photo presentation crossover"><div className={styles.legacyLook} style={legacyLookStyle(left, direction)} /><div className={styles.legacyLook} style={legacyLookStyle(right, direction)} /></div>;
}

function PairwiseExperiment({ direction, material, presentationOrder, responses, onResponses }: { direction: WardrobeDirection; material: Material; presentationOrder: CalibrationPresentationOrder; responses: CalibrationResponse[]; onResponses: (responses: CalibrationResponse[]) => void }) {
  const [index, setIndex] = useState(0);
  const question = calibrationCatalogV2.questions[index];
  const current = responses.find((response) => response.questionId === question.id)?.choice;
  const presentedOptions = presentationOrder.map((canonicalId) => ({
    canonicalId,
    option: canonicalId === "a" ? question.optionA : question.optionB,
  }));
  function answer(choice: CalibrationResponseChoice) {
    onResponses(upsertCalibrationResponse(responses, createCalibrationResponse(question.id, choice, 1_750_000_000_000 + index, calibrationCatalogV2, presentationOrder)));
    if (index < calibrationCatalogV2.questions.length - 1) setIndex(index + 1);
  }
  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div><h2>{question.prompt}</h2><p className={styles.muted}>Choose the outfit you would reach for, not the prettier image.</p></div><span className={styles.counter}>{index + 1} / 6</span></div>
    <PairBoard questionIndex={index} material={material} direction={direction} presentationOrder={presentationOrder} />
    <div className={styles.labels}>{presentedOptions.map(({ canonicalId, option }) => <span key={canonicalId}>{canonicalId.toUpperCase()} · {option.label}</span>)}</div>
    <div className={styles.answers}>
      {presentedOptions.map(({ canonicalId }) => <button key={canonicalId} className={styles.answerButton} data-active={current === canonicalId} onClick={() => answer(canonicalId)}>{canonicalId.toUpperCase()} feels more like me</button>)}
      <button className={styles.answerButton} data-active={current === "both"} onClick={() => answer("both")}>Both</button>
      <button className={styles.answerButton} data-active={current === "neither"} onClick={() => answer("neither")}>Neither</button>
      <button className={`${styles.answerButton} ${styles.answerWide}`} data-active={current === "skip"} onClick={() => answer("skip")}>Not sure · Skip</button>
    </div>
    <p className={styles.labNote}>{material === "controlled" ? "Controlled asset: matched mannequin, camera, scale and backdrop. Known confounds remain documented in the asset manifest." : "Legacy crossover: different models and photography can change the answer, while semantic IDs intentionally stay fixed for bias testing."}</p>
    <div className={styles.navigation}><button className={styles.secondaryButton} disabled={index === 0} onClick={() => setIndex(Math.max(0, index - 1))}>Previous</button><button className={styles.secondaryButton} disabled={index === 5} onClick={() => setIndex(Math.min(5, index + 1))}>Next</button></div>
  </section>;
}

function LegacySingleExperiment({ direction, feedback, onFeedback }: { direction: WardrobeDirection; feedback: StyleFeedback[]; onFeedback: (feedback: StyleFeedback[]) => void }) {
  const [index, setIndex] = useState(0);
  const lookId = `look-${index + 1}`;
  const current = feedback.find((entry) => entry.lookId === lookId)?.sentiment;
  function answer(sentiment: StyleFeedback["sentiment"]) {
    onFeedback([...feedback.filter((entry) => entry.lookId !== lookId), { lookId, sentiment }]);
    if (index < 5) setIndex(index + 1);
  }
  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div><h2>Would you wear this?</h2><p className={styles.muted}>Legacy single-card baseline.</p></div><span className={styles.counter}>{index + 1} / 6</span></div>
    <div className={styles.board}><div className={styles.legacyLook} style={{ ...legacyLookStyle(index, direction), width: "100%", height: "100%" }} /></div>
    <div className={styles.answers}>{legacyFeedbackChoices.map((sentiment) => <button key={sentiment} className={styles.answerButton} data-active={current === sentiment} onClick={() => answer(sentiment)}>{sentiment === "like" ? "Would wear" : sentiment === "dislike" ? "Not for me" : "Skip"}</button>)}</div>
    <p className={styles.labNote}>This reproduces the low-information baseline: no comparison, one style tied to one model, and all non-Skip answers increase confidence.</p>
    <div className={styles.navigation}><button className={styles.secondaryButton} disabled={index === 0} onClick={() => setIndex(Math.max(0, index - 1))}>Previous</button><button className={styles.secondaryButton} disabled={index === 5} onClick={() => setIndex(Math.min(5, index + 1))}>Next</button></div>
  </section>;
}

export function CalibrationLab() {
  const [method, setMethod] = useState<Method>("pairwise");
  const [material, setMaterial] = useState<Material>("controlled");
  const [presentation, setPresentation] = useState<Presentation>("a-left");
  const [direction, setDirection] = useState<WardrobeDirection>("neutral");
  const [responses, setResponses] = useState<CalibrationResponse[]>([]);
  const [legacyFeedback, setLegacyFeedback] = useState<StyleFeedback[]>([]);
  const presentationOrder: CalibrationPresentationOrder = presentation === "a-left" ? ["a", "b"] : ["b", "a"];

  const profile = useMemo(() => method === "pairwise"
    ? buildCalibrationPreferenceProfile({ direction, responses, now: 1_750_000_000_000 })
    : buildPreferenceProfile({ direction, feedback: legacyFeedback, moreOf: [], lessOf: [], freeform: "", now: 1_750_000_000_000 }), [direction, legacyFeedback, method, responses]);
  const baseline = useMemo(() => createNeutralPreferenceProfile(1_750_000_000_000), []);
  const ranking = useMemo(() => ({
    neutral: runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile: baseline, weather: null, operation: "initial", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }).deterministicAnswer,
    calibrated: runRecommendationDecision({ wardrobe: demoWardrobe, intent: demoIntent, profile, weather: null, operation: "initial", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }).deterministicAnswer,
  }), [baseline, profile]);

  function preset(choice: CalibrationResponseChoice) {
    setMethod("pairwise");
    setResponses(calibrationCatalogV2.questions.map((question, index) => createCalibrationResponse(question.id, choice, 1_750_000_000_000 + index, calibrationCatalogV2, presentationOrder)));
  }
  function mixedPreset() {
    const choices: CalibrationResponseChoice[] = ["a", "b", "both", "a", "b", "skip"];
    setMethod("pairwise");
    setResponses(calibrationCatalogV2.questions.map((question, index) => createCalibrationResponse(question.id, choices[index], 1_750_000_000_000 + index, calibrationCatalogV2, presentationOrder)));
  }
  function reset() { setResponses([]); setLegacyFeedback([]); }

  const signals = profile.preferenceSignals ?? [];
  const confidence = profile.profileConfidence ?? { evidence: 0, coverage: 0, differentiation: 0, overall: 0 };
  const axes = Object.entries(profile.styleVector) as [string, number][];

  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.header}><h1>Style Calibration Lab</h1><p>Research surface only. Nothing here is persisted. Compare interaction and presentation while keeping the semantic contract and recommendation inputs visible.</p></header>
    <div className={styles.controls}>
      <label className={styles.control}><span>Method</span><select value={method} onChange={(event) => setMethod(event.target.value as Method)}><option value="pairwise">Pairwise + Both/Neither/Skip</option><option value="legacy-single">Legacy single card</option></select></label>
      <label className={styles.control}><span>Material</span><select value={material} disabled={method === "legacy-single"} onChange={(event) => setMaterial(event.target.value as Material)}><option value="controlled">Controlled mannequin pairs</option><option value="legacy-model">Legacy model-photo crossover</option></select></label>
      <label className={styles.control}><span>Wardrobe direction</span><select value={direction} onChange={(event) => setDirection(event.target.value as WardrobeDirection)}>{directions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className={styles.control}><span>Position order</span><select value={presentation} disabled={method === "legacy-single"} onChange={(event) => setPresentation(event.target.value as Presentation)}><option value="a-left">A left · B right</option><option value="b-left">B left · A right</option></select></label>
      <label className={styles.control}><span>Evidence count</span><select value={method === "pairwise" ? responses.length : legacyFeedback.length} disabled><option>{method === "pairwise" ? responses.length : legacyFeedback.length}</option></select></label>
    </div>
    <div className={styles.presetRow}><button className={styles.presetButton} onClick={() => preset("both")}>All Both</button><button className={styles.presetButton} onClick={() => preset("neither")}>All Neither</button><button className={styles.presetButton} onClick={() => preset("skip")}>All Skip</button><button className={styles.presetButton} onClick={mixedPreset}>Mixed</button><button className={styles.presetButton} onClick={reset}>Reset</button></div>
    <div className={styles.grid}>
      {method === "pairwise" ? <PairwiseExperiment direction={direction} material={material} presentationOrder={presentationOrder} responses={responses} onResponses={setResponses} /> : <LegacySingleExperiment direction={direction} feedback={legacyFeedback} onFeedback={setLegacyFeedback} />}
      <aside className={`${styles.panel} ${styles.results}`}>
        <div className={styles.panelHeader}><div><h2>Derived profile</h2><p className={styles.muted}>{method === "pairwise" ? "Canonical evidence" : "Legacy estimator"}</p></div><span className={styles.counter}>revision {profile.revision ?? 0}</span></div>
        <div className={styles.metrics}>{Object.entries(confidence).map(([key, value]) => <div className={styles.metric} key={key}><span>{key}</span><strong>{value.toFixed(2)}</strong></div>)}</div>
        <div className={styles.signalSection}><h3>More</h3><div className={styles.chips}>{signals.filter((signal) => signal.polarity === "more").map((signal) => <span className={styles.chip} key={signal.id}>{signal.label}</span>)}{!signals.some((signal) => signal.polarity === "more") && <span className={styles.muted}>None</span>}</div></div>
        <div className={styles.signalSection}><h3>Less</h3><div className={styles.chips}>{signals.filter((signal) => signal.polarity === "less").map((signal) => <span className={styles.chip} data-tone="less" key={signal.id}>{signal.label}</span>)}{!signals.some((signal) => signal.polarity === "less") && <span className={styles.muted}>None</span>}</div></div>
        <div className={styles.signalSection}><h3>Unknown / relative loser</h3><div className={styles.chips}>{signals.filter((signal) => signal.polarity === "unknown").map((signal) => <span className={styles.chip} data-tone="unknown" key={signal.id}>{signal.label}</span>)}{!signals.some((signal) => signal.polarity === "unknown") && <span className={styles.muted}>None</span>}</div></div>
        <div className={styles.signalSection}><h3>Style vector</h3><div className={styles.vector}>{axes.map(([axis, value]) => <div className={styles.axis} key={axis}><span>{axis}</span><span className={styles.track}><i className={styles.fill} style={axisFill(value)} /></span><code>{value.toFixed(3)}</code></div>)}</div></div>
        <div className={styles.signalSection}><h3>Recommendation counterfactual</h3><div className={styles.comparison}><div><span>Neutral</span><code>{ranking.neutral.id}</code><strong>{ranking.neutral.scoreTrace?.dimensions.personalFit.toFixed(3)}</strong></div><div><span>Calibrated</span><code>{ranking.calibrated.id}</code><strong>{ranking.calibrated.scoreTrace?.dimensions.personalFit.toFixed(3)}</strong></div></div></div>
      </aside>
    </div>
  </div></main>;
}
