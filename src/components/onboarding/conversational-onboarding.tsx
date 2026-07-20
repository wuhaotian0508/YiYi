"use client";

import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { TextPlugin } from "gsap/TextPlugin";
import { useReducedMotionConfig } from "motion/react";
import { OutfitCanvas } from "@/components/outfit/outfit-canvas";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import { PrimaryButton } from "@/components/ui/buttons";
import { VoiceCore, type VoiceVisualState } from "@/components/voice/voice-core";
import { OutfitSchema, type Outfit } from "@/domain/schemas";
import { demoWardrobe } from "@/mocks/wardrobe";
import styles from "./conversational-onboarding.module.css";

gsap.registerPlugin(useGSAP, TextPlugin);

export const onboardingStoryLabels = [
  "arrival",
  "arrival:promise",
  "arrival:ready",
  "decision:start",
  "decision:questions-complete",
  "decision:cursor-hold",
  "decision:delete",
  "reframe:start",
  "reframe:complete",
  "understanding",
  "outfit:assemble",
  "revision:request",
  "revision:replace",
  "complete",
] as const;

export type OnboardingStoryLabel = (typeof onboardingStoryLabels)[number];

export type OnboardingTimelineController = {
  timeline: gsap.core.Timeline;
  labels: readonly OnboardingStoryLabel[];
  play: () => void;
  pause: () => void;
  restart: () => void;
  seek: (label: OnboardingStoryLabel) => void;
  timeScale: (value: number) => void;
};

const recommendationBefore: Outfit = OutfitSchema.parse({
  id: "88888888-8888-4888-8888-888888888881",
  itemIds: {
    outerwear: "11111111-1111-4111-8111-111111111113",
    top: "22222222-2222-4222-8222-222222222223",
    bottom: "33333333-3333-4333-8333-333333333332",
    shoes: "44444444-4444-4444-8444-444444444442",
    bag: "55555555-5555-4555-8555-555555555551",
  },
  deterministicScore: 9,
});

const recommendationAfter: Outfit = OutfitSchema.parse({
  ...recommendationBefore,
  id: "88888888-8888-4888-8888-888888888882",
  itemIds: { ...recommendationBefore.itemIds, shoes: "44444444-4444-4444-8444-444444444441" },
});

function timeFor(timeline: gsap.core.Timeline, label: OnboardingStoryLabel) {
  return timeline.labels[label] ?? 0;
}

export function ConversationalOnboarding({
  onComplete,
  reviewMode = false,
  onTimelineReady,
}: {
  onComplete: () => void;
  reviewMode?: boolean;
  onTimelineReady?: (controller: OnboardingTimelineController) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const splashRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const promiseRef = useRef<HTMLDivElement>(null);
  const beginRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const decisionRef = useRef<HTMLDivElement>(null);
  const decisionTextRef = useRef<HTMLSpanElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const understandingRef = useRef<HTMLDivElement>(null);
  const understandingStatusRef = useRef<HTMLParagraphElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const outfitRef = useRef<HTMLDivElement>(null);
  const outfitCanvasRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLDivElement>(null);
  const revisionRequestRef = useRef<HTMLDivElement>(null);
  const meaningBeforeRef = useRef<HTMLSpanElement>(null);
  const meaningAfterRef = useRef<HTMLSpanElement>(null);
  const revisedReasonRef = useRef<HTMLParagraphElement>(null);
  const continuityRef = useRef<HTMLParagraphElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const completeRef = useRef(onComplete);
  useEffect(() => { completeRef.current = onComplete; }, [onComplete]);
  const reduceMotion = Boolean(useReducedMotionConfig());
  const [begun, setBegun] = useState(false);
  const [revised, setRevised] = useState(false);
  const [coreState, setCoreState] = useState<VoiceVisualState>("idle");

  useGSAP(() => {
    const root = rootRef.current;
    const splash = splashRef.current;
    const title = titleRef.current;
    const promise = promiseRef.current;
    const begin = beginRef.current;
    const story = storyRef.current;
    const decision = decisionRef.current;
    const decisionText = decisionTextRef.current;
    const caret = caretRef.current;
    const understanding = understandingRef.current;
    const understandingStatus = understandingStatusRef.current;
    const tags = tagsRef.current;
    const outfit = outfitRef.current;
    const outfitCanvas = outfitCanvasRef.current;
    const reason = reasonRef.current;
    const revisionRequest = revisionRequestRef.current;
    const meaningBefore = meaningBeforeRef.current;
    const meaningAfter = meaningAfterRef.current;
    const revisedReason = revisedReasonRef.current;
    const continuity = continuityRef.current;
    if (!root || !splash || !title || !promise || !begin || !story || !decision || !decisionText || !caret || !understanding || !understandingStatus || !tags || !outfit || !outfitCanvas || !reason || !revisionRequest || !meaningBefore || !meaningAfter || !revisedReason || !continuity) return;

    const tagNodes = tags.querySelectorAll("[data-story-tag]");
    const outfitPieces = outfitCanvas.querySelectorAll("[data-slot]");
    const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
    timelineRef.current = timeline;

    gsap.set([title, promise, begin, story, decision, understanding, outfit, reason, revisionRequest, meaningAfter, revisedReason, continuity], { autoAlpha: 0 });
    gsap.set([tagNodes, outfitPieces], { autoAlpha: 0 });
    gsap.set(title, { y: reduceMotion ? 0 : 8 });
    gsap.set(promise, { y: reduceMotion ? 0 : 6 });
    gsap.set(begin, { y: reduceMotion ? 0 : 5 });
    gsap.set([decision, understanding, outfit], { y: reduceMotion ? 0 : 8 });
    gsap.set(outfitPieces, { y: reduceMotion ? 0 : 10 });
    gsap.set(caret, { autoAlpha: 0 });
    gsap.set(decisionText, { text: { value: "", delimiter: "" } });

    timeline
      .addLabel("arrival", 0)
      .to(title, { autoAlpha: 1, y: 0, duration: reduceMotion ? 0.24 : 0.68 }, 0.28)
      .addLabel("arrival:promise", 1.25)
      .to(promise, { autoAlpha: 1, y: 0, duration: reduceMotion ? 0.24 : 0.72 }, 1.25)
      .addLabel("arrival:ready", 3.75)
      .to(begin, { autoAlpha: 1, y: 0, duration: reduceMotion ? 0.18 : 0.3 }, 3.75)
      .addPause(4.05)
      // Keep the interaction boundary after the pause. GSAP callbacks placed at
      // the exact pause timestamp may run while the playhead arrives, which
      // would auto-advance the splash before the user presses Begin.
      .addLabel("decision:start", 4.06)
      .call(() => { setBegun(true); setRevised(false); setCoreState("idle"); }, [], 4.06)
      .set(splash, { autoAlpha: 0 }, 4.06)
      .set(story, { autoAlpha: 1 }, 4.06)
      .to(decision, { autoAlpha: 1, y: 0, duration: reduceMotion ? 0.2 : 0.45 }, 4.06);

    if (reduceMotion) {
      timeline
        .set(decisionText, { text: { value: "Maybe my navy hoodie...\nwith blue jeans...\n\nNo, maybe the black trousers...\nor the grey jacket...\n\nNo... no...\nwhat should I wear?????", delimiter: "", preserveSpaces: true } }, 4.45)
        .addLabel("decision:questions-complete", 7.65)
        .set(caret, { autoAlpha: 1 }, 7.65)
        .addLabel("decision:cursor-hold", 8.4)
        .addLabel("decision:delete", 8.8)
        .to([decisionText, caret], { autoAlpha: 0, duration: 0.2 }, 8.8)
        .set(decisionText, { text: { value: "", delimiter: "", preserveSpaces: true } }, 9.05)
        .addLabel("reframe:start", 9.25)
        .set(decisionText, { text: { value: "I have class, dinner with friends,\nand a lot of walking.\nI want to feel relaxed and still look put together.", delimiter: "", preserveSpaces: true }, autoAlpha: 0 }, 9.25)
        .to(decisionText, { autoAlpha: 1, duration: 0.24 }, 9.25)
        .addLabel("reframe:complete", 12.85);
    } else {
      timeline
        .to(decisionText, { text: { value: "Maybe my navy hoodie...", delimiter: "", preserveSpaces: true }, duration: 2.25, ease: "none" }, 4.7)
        .to(decisionText, { text: { value: "Maybe my navy hoodie...\nwith blue jeans...", delimiter: "", preserveSpaces: true }, duration: 1.6, ease: "none" }, 7.4)
        .to(decisionText, { text: { value: "Maybe my navy hoodie...\nwith blue jeans...\n\nNo, maybe the black trousers...", delimiter: "", preserveSpaces: true }, duration: 2.5, ease: "none" }, 9.55)
        .to(decisionText, { text: { value: "Maybe my navy hoodie...\nwith blue jeans...\n\nNo, maybe the black trousers...\nor the grey jacket...", delimiter: "", preserveSpaces: true }, duration: 1.8, ease: "none" }, 12.6)
        .to(decisionText, { text: { value: "Maybe my navy hoodie...\nwith blue jeans...\n\nNo, maybe the black trousers...\nor the grey jacket...\n\nNo... no...", delimiter: "", preserveSpaces: true }, duration: 1.3, ease: "none" }, 15.1)
        .to(decisionText, { text: { value: "Maybe my navy hoodie...\nwith blue jeans...\n\nNo, maybe the black trousers...\nor the grey jacket...\n\nNo... no...\nwhat should I wear?", delimiter: "", preserveSpaces: true }, duration: 1.7, ease: "none" }, 16.6)
        .to(decisionText, { text: { value: "Maybe my navy hoodie...\nwith blue jeans...\n\nNo, maybe the black trousers...\nor the grey jacket...\n\nNo... no...\nwhat should I wear??", delimiter: "", preserveSpaces: true }, duration: 0.22, ease: "none" }, 18.3)
        .to(decisionText, { text: { value: "Maybe my navy hoodie...\nwith blue jeans...\n\nNo, maybe the black trousers...\nor the grey jacket...\n\nNo... no...\nwhat should I wear???", delimiter: "", preserveSpaces: true }, duration: 0.16, ease: "none" })
        .to(decisionText, { text: { value: "Maybe my navy hoodie...\nwith blue jeans...\n\nNo, maybe the black trousers...\nor the grey jacket...\n\nNo... no...\nwhat should I wear????", delimiter: "", preserveSpaces: true }, duration: 0.12, ease: "none" })
        .to(decisionText, { text: { value: "Maybe my navy hoodie...\nwith blue jeans...\n\nNo, maybe the black trousers...\nor the grey jacket...\n\nNo... no...\nwhat should I wear?????", delimiter: "", preserveSpaces: true }, duration: 0.1, ease: "none" })
        .addLabel("decision:questions-complete")
        .set(caret, { autoAlpha: 1 })
        .addLabel("decision:cursor-hold", "+=1.15")
        .addLabel("decision:delete")
        .to(decisionText, { text: { value: "", delimiter: "", preserveSpaces: true, rtl: true }, duration: 3.4, ease: "power2.in" })
        .set(caret, { autoAlpha: 0 })
        .addLabel("reframe:start", "+=0.45")
        .to(decisionText, { text: { value: "I have class, dinner with friends,\nand a lot of walking.", delimiter: "", preserveSpaces: true }, duration: 4.15, ease: "none" })
        .to(decisionText, { text: { value: "I have class, dinner with friends,\nand a lot of walking.\nI want to feel relaxed and still look put together.", delimiter: "", preserveSpaces: true }, duration: 3.95, ease: "none", delay: 0.45 })
        .addLabel("reframe:complete");
    }

    timeline
      .to(decision, { autoAlpha: 0, y: reduceMotion ? 0 : -6, duration: reduceMotion ? 0.2 : 0.36 }, "+=0.9")
      .addLabel("understanding")
      .call(() => setCoreState("listening"))
      .to(understanding, { autoAlpha: 1, y: 0, duration: reduceMotion ? 0.22 : 0.42 })
      .to(understandingStatus, { opacity: 0.45, duration: 0.24 }, "+=0.55")
      .call(() => setCoreState("thinking"))
      .set(understandingStatus, { textContent: "Understanding…", opacity: 0.45 })
      .to(understandingStatus, { opacity: 1, duration: 0.22 })
      .to(tagNodes, { autoAlpha: 1, y: 0, duration: reduceMotion ? 0.16 : 0.3, stagger: reduceMotion ? 0.18 : 0.34 })
      .to(understanding, { autoAlpha: 0, y: reduceMotion ? 0 : -5, duration: reduceMotion ? 0.2 : 0.34 }, "+=0.5")
      .addLabel("outfit:assemble")
      .to(outfit, { autoAlpha: 1, y: 0, duration: reduceMotion ? 0.22 : 0.38 })
      .to(outfitPieces, { autoAlpha: 1, y: 0, duration: reduceMotion ? 0.18 : 0.46, stagger: reduceMotion ? 0.12 : 0.38 })
      .to(reason, { autoAlpha: 1, duration: reduceMotion ? 0.18 : 0.32 }, "+=0.25")
      .addLabel("revision:request", "+=1.2")
      .call(() => setCoreState("thinking"))
      .to(revisionRequest, { autoAlpha: 1, y: 0, duration: reduceMotion ? 0.2 : 0.36 })
      .to(meaningBefore, { autoAlpha: 0, y: reduceMotion ? 0 : -3, duration: reduceMotion ? 0.16 : 0.24 }, "+=0.65")
      .to(meaningAfter, { autoAlpha: 1, y: 0, duration: reduceMotion ? 0.16 : 0.28 }, "<0.1")
      .addLabel("revision:replace", "+=0.35")
      .call(() => setRevised(true))
      .to([reason, revisionRequest], { autoAlpha: 0, y: reduceMotion ? 0 : -3, duration: 0.18 }, "+=0.65")
      .to(revisedReason, { autoAlpha: 1, duration: reduceMotion ? 0.18 : 0.3 })
      .addLabel("complete", "+=0.25")
      .to(continuity, { autoAlpha: 1, duration: reduceMotion ? 0.18 : 0.3 })
      .call(() => {
        if (!reviewMode) completeRef.current();
      }, [], "+=1.8");

    function syncStateAt(time: number) {
      const storyStarted = time >= timeFor(timeline, "decision:start");
      setBegun(storyStarted);
      setRevised(time >= timeFor(timeline, "revision:replace"));
      if (time >= timeFor(timeline, "understanding")) setCoreState("thinking");
      else setCoreState("idle");
    }

    function reviewTimeFor(label: OnboardingStoryLabel) {
      const offset: Partial<Record<OnboardingStoryLabel, number>> = {
        arrival: reduceMotion ? 0.24 : 0.68,
        "arrival:promise": reduceMotion ? 0.24 : 0.72,
        "arrival:ready": reduceMotion ? 0.18 : 0.3,
        "decision:start": reduceMotion ? 0.2 : 0.45,
        "decision:questions-complete": 0.01,
        "decision:delete": reduceMotion ? 0.12 : 1.7,
        "reframe:start": reduceMotion ? 0.24 : 0.9,
        understanding: reduceMotion ? 1.35 : 2.2,
        "outfit:assemble": reduceMotion ? 1.25 : 2.95,
        "revision:request": reduceMotion ? 0.75 : 1.1,
        "revision:replace": 0.01,
        complete: reduceMotion ? 0.18 : 0.3,
      };
      return Math.min(timeline.duration(), timeFor(timeline, label) + (offset[label] ?? 0));
    }

    const controller: OnboardingTimelineController = {
      timeline,
      labels: onboardingStoryLabels,
      play: () => timeline.play(),
      pause: () => timeline.pause(),
      restart: () => { setBegun(false); setRevised(false); setCoreState("idle"); timeline.restart(); },
      seek: (label) => {
        const reviewTime = reviewTimeFor(label);
        timeline.pause(reviewTime);
        // Labels mark transition boundaries in the production storyboard. The
        // review control lands on the first representative visual frame so a
        // named screenshot never captures an intentionally empty boundary.
        syncStateAt(reviewTime + 0.001);
      },
      timeScale: (value) => timeline.timeScale(value),
    };
    onTimelineReady?.(controller);
    if (process.env.NODE_ENV === "test") timeline.pause(Math.max(0, timeFor(timeline, "decision:start") - 0.01));

    return () => {
      timelineRef.current = null;
      timeline.kill();
    };
  }, { scope: rootRef, dependencies: [reduceMotion, reviewMode], revertOnUpdate: true });

  function begin() {
    setBegun(true);
    timelineRef.current?.play();
  }

  function skip() {
    timelineRef.current?.pause();
    completeRef.current();
  }

  return <div className={styles.root} ref={rootRef} data-onboarding-scene data-reduced-motion={reduceMotion}>
    <section className={styles.splash} ref={splashRef} aria-hidden={begun}>
      <div className={styles.splashCenter}>
        <h1 ref={titleRef}>What should I wear today?</h1>
        <div className={styles.promise} ref={promiseRef}><span>Tell</span><YiYiMark size={34} /><span>in one sentence.</span></div>
      </div>
      <div className={styles.begin} ref={beginRef}><PrimaryButton onClick={begin}>Begin</PrimaryButton></div>
    </section>

    <section className={styles.story} ref={storyRef} aria-hidden={!begun} inert={!begun ? true : undefined}>
      <header className={styles.storyTopbar}><span /><span>How YiYi helps</span><button type="button" onClick={skip}>Skip</button></header>
      <div className={styles.stage}>
        <div className={styles.decision} ref={decisionRef}>
          <p className={styles.eyebrow}>Thinking out loud</p>
          <div className={styles.input} role="img" aria-label="An example of someone hesitating, deleting their draft, and then describing their day instead">
            <span ref={decisionTextRef} aria-hidden="true" data-story-text />
            <span className={styles.caret} ref={caretRef} aria-hidden="true" data-story-caret />
          </div>
        </div>

        <div className={styles.understanding} ref={understandingRef}>
          <p className={styles.quote}>“I have class, dinner with friends, and a lot of walking. I want to feel relaxed and still look put together.”</p>
          <VoiceCore state={coreState} label="YiYi is understanding the example" />
          <p className={styles.coreStatus} ref={understandingStatusRef}>Listening…</p>
          <div className={styles.tags} ref={tagsRef} aria-label="What YiYi understood">
            {["Class", "Dinner", "Lots of walking", "Relaxed", "Put together"].map((tag) => <span data-story-tag key={tag}>{tag}</span>)}
          </div>
        </div>

        <div className={styles.outfit} ref={outfitRef}>
          <div className={styles.outfitHeading}>
            <div className={styles.outfitTags} aria-label="Recommendation intent">
              <span>Class + dinner</span><span>Walking</span><span className={styles.meaning}><span ref={meaningBeforeRef}>Put together</span><span ref={meaningAfterRef}>Relaxed</span></span>
            </div>
            <div className={styles.reason} ref={reasonRef}><h2>I’d wear this one.</h2><p>Clean tailoring, grounded by shoes made for the day.</p></div>
          </div>
          <div className={styles.canvas} ref={outfitCanvasRef}><OutfitCanvas outfit={revised ? recommendationAfter : recommendationBefore} wardrobe={demoWardrobe} /></div>
          <div className={styles.revisionRequest} ref={revisionRequestRef}><span>“Make it a little more relaxed.”</span><small>YiYi is revising the shoes</small></div>
          <p className={styles.revisedReason} ref={revisedReasonRef}>The sneakers relax the tailoring without changing the rest.</p>
          <p className={styles.continuity} ref={continuityRef}>Only the shoes changed. Everything else stayed.</p>
        </div>
      </div>
    </section>
  </div>;
}
