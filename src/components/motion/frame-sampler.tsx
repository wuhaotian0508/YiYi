"use client";

import { useEffect, useRef, useState } from "react";

type FrameSample = {
  median: number;
  p95: number;
  p99: number;
  baseline: number;
  severeFrames: number;
  maxConsecutiveSevereFrames: number;
};

function percentile(values: readonly number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

export function DevFrameSampler() {
  const frameRef = useRef<number | null>(null);
  const [sampling, setSampling] = useState(false);
  const [sample, setSample] = useState<FrameSample | null>(null);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  function start() {
    if (process.env.NODE_ENV === "production" || sampling) return;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    setSampling(true);
    setSample(null);
    const intervals: number[] = [];
    let previous: number | null = null;
    let startedAt: number | null = null;

    const tick = (timestamp: number) => {
      startedAt ??= timestamp;
      if (previous !== null) intervals.push(timestamp - previous);
      previous = timestamp;
      if (timestamp - startedAt < 2_800) {
        frameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      frameRef.current = null;
      const baselineWindow = [...intervals].sort((left, right) => left - right).slice(0, Math.max(12, Math.ceil(intervals.length * 0.35)));
      const baseline = percentile(baselineWindow, 0.5) || 16.67;
      const severeThreshold = baseline * 2.5;
      let severeFrames = 0;
      let currentRun = 0;
      let maxRun = 0;
      for (const interval of intervals) {
        if (interval > severeThreshold) {
          severeFrames += 1;
          currentRun += 1;
          maxRun = Math.max(maxRun, currentRun);
        } else currentRun = 0;
      }
      setSample({
        median: percentile(intervals, 0.5),
        p95: percentile(intervals, 0.95),
        p99: percentile(intervals, 0.99),
        baseline,
        severeFrames,
        maxConsecutiveSevereFrames: maxRun,
      });
      setSampling(false);
    };
    frameRef.current = window.requestAnimationFrame(tick);
  }

  if (process.env.NODE_ENV === "production") return null;
  return <section className="motion-frame-sampler" aria-label="Development frame sampler">
    <button type="button" onClick={start} disabled={sampling}>{sampling ? "Sampling 2.8s…" : "Sample frames"}</button>
    {sample && <output data-frame-sample>
      <span>baseline {sample.baseline.toFixed(2)}ms</span>
      <span>median {sample.median.toFixed(2)}ms</span>
      <span>p95 {sample.p95.toFixed(2)}ms</span>
      <span>p99 {sample.p99.toFixed(2)}ms</span>
      <span>severe {sample.severeFrames}</span>
      <span>max run {sample.maxConsecutiveSevereFrames}</span>
    </output>}
  </section>;
}
