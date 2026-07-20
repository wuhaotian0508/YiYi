# YiYi Motion Architecture Decision

Status: Accepted for implementation
Date: 2026-07-20

## Decision

YiYi will use three mature engines with non-overlapping ownership:

| Surface | Owner | Why |
| --- | --- | --- |
| Authored onboarding scene | GSAP timeline + TextPlugin + `useGSAP()` | Named labels, deterministic seek/restart, authored holds, reversible text, scoped cleanup |
| Runtime state, presence, layout, local gestures | Motion for React | Existing dependency, React-aware presence/layout, interruptible motion values and user reduced-motion support |
| Today ↔ Wardrobe page track | Swiper React | Mature finger tracking, axis intent, velocity completion, resistance, Safari-specific behavior |
| Press, focus, static color changes | CSS | No timeline, shared layout, or spring is required |
| YiYi Core state asset | Existing SVG + Motion/CSS | No production-quality `.riv` asset exists; Rive would add runtime cost without a better state model |

GSAP and Motion must never write the same property on the same DOM node. Swiper exclusively owns the page-track transform. Motion may animate descendants inside a slide but never the Swiper wrapper or slide transform.

## Why the current architecture is replaced

The current experience mixes page-level CSS arrival, Motion presence, per-component delay chains, timer-driven React state, and a hand-written swipe threshold. This creates four systemic failures:

1. reading content is time-boxed by uniform short staggers;
2. authored onboarding cannot be paused, sought, replayed, or deterministically reviewed;
3. gesture state is not spatially continuous with the user's finger;
4. multiple engines can affect the same visual hierarchy, making interruption and cleanup unreliable.

Extending the existing timers or writing more gesture projection logic would preserve these failure modes.

## Dependency and platform decision

| Package | Selected version | License | Integration boundary |
| --- | --- | --- | --- |
| `gsap` | 3.15.x | GSAP Standard no-charge license | Onboarding client component only; TextPlugin registered there |
| `@gsap/react` | 2.1.x | Same GSAP terms | Scopes authored timeline and reverts on unmount |
| `swiper` | 14.0.x | MIT | Two-slide Today/Wardrobe shell; core CSS only |
| `motion` | Existing 12.42.2 | MIT | All runtime presence/layout/state interactions |

GSDevTools is development-only and dynamically imported only by the motion review surface. A production-only Turbopack alias replaces the review client with a null stub, while the server route returns `notFound()`. This prevents review controls and frame instrumentation from entering deployable client chunks. SplitText is not selected: TextPlugin is sufficient for the single text surface, while SplitText would add DOM, responsive re-splitting, and accessibility complexity without a demonstrated need.

## Motion classes and time models

Motion values are semantic rather than one universal duration:

| Class | Typical model | Contract |
| --- | --- | --- |
| Press/focus | CSS, 70–140 ms | Immediate down-state; release may settle slightly more slowly |
| Short state change | Motion tween, 160–240 ms | Opacity/color or very small transform; replace stale animation |
| Reading text | Authored GSAP holds | Completion depends on phrase length and punctuation; never a generic stagger |
| Narrative scene | One GSAP timeline | Named labels, deterministic seek/restart, Skip-safe cleanup |
| Local replacement | Motion presence/layout, spring | Target slot only; all unmentioned item boxes remain invariant |
| Bottom sheet | Motion drag + spring | Follows finger, velocity/distance dismissal, re-grabbable, focus-safe |
| Direct page manipulation | Swiper | 1:1 follow, axis tolerance, velocity completion, resistance, system-edge coexistence |
| Whole-page state | Motion presence | Low-amplitude spatial transition only when it communicates hierarchy |

Runtime springs are limited to three named roles: quick feedback, calm settle, and sheet settle. Arbitrary per-component springs are not allowed. Opacity-only transitions use named short/standard durations.

## State ownership

- The Realtime coordinator remains the single source for voice lifecycle. Motion consumes its snapshot and never initiates a connection.
- Recommendation operation/version state remains the source for initial, revision, random, undo, and confirm visuals. Animation completion cannot commit product state.
- Calibration/profile persistence remains the source for preference insertion/removal. Motion never synthesizes optimistic preference chips that were not persisted.
- GSAP may schedule view-state callbacks inside onboarding, but every callback is generation-scoped and the timeline is killed/reverted on Skip, route change, or unmount.

## Interruptibility and cleanup

- A new runtime operation replaces the previous animation for the same owned node; it does not queue behind it.
- Targeted revision keys presence by `slot + itemId`; only the target slot exits and enters.
- Random followed by Undo renders the winning persisted version and cancels the stale reveal.
- Voice state changes replace the current Core animation immediately.
- Swiper and Bottom Sheet never share a gesture surface. An open sheet disables page swiping until it closes.
- Timelines, Motion scopes, Swiper listeners, media/listeners owned elsewhere, requestAnimationFrame samples, and development controls are all disposed on unmount.

## Reduced motion

The root uses `MotionConfig reducedMotion="user"`. Runtime transforms and layout animations become opacity/state changes. The authored onboarding timeline keeps its information order and readable holds, but replaces typing, deletion, assembly movement, and shoe travel with discrete opacity/text-state transitions. Direct page swiping remains user-driven but release settles without ornamental overshoot. No meaning depends on animation, color, or sound alone.

## Review and evidence

The development-only `/motion-review` route renders production components and exposes named timeline states, voice states, outfit mutations, the pager, approved calibration states, speed controls, reduced motion, and frame sampling. Dedicated Playwright tests validate state, geometry, interruption, and screenshots at the four target iPhone viewports. Safari/iPhone review remains required for touch feel, address-bar/safe-area behavior, real refresh cadence, audio routing, and subjective pacing.

## Production bundle evidence

The production route responds 404 and its client manifest contains only the two shared Next.js runtime chunks (60.3 kB raw / 15.3 kB gzip); it contains no review component. String scans of `.next/static/chunks` return zero matches for GSDevTools, frame-sample markup, onboarding timeline controls, and Fine-tune review copy. The remaining `data-motion-review` global selector was removed so review instrumentation is not retained through shared CSS.

The two intentional runtime costs are route-scoped:

| Route | Engine chunk | Raw | Gzip | Reason |
| --- | --- | ---: | ---: | --- |
| First-run onboarding | GSAP + TextPlugin + React integration | 122.9 kB | 43.0 kB | Authored, seekable text narrative only |
| Today | Swiper React/core | 116.6 kB | 34.9 kB | Direct-manipulation Today ↔ Wardrobe track only |

Motion was already installed. Rive, SplitText, Tone.js, and a second page-gesture implementation add zero bundle cost because they were not adopted.

## Rejected alternatives

- A custom timeline/playhead: duplicates GSAP lifecycle and deterministic seek behavior.
- A custom page gesture arena or projected endpoint: duplicates Swiper and retains current threshold brittleness.
- GSAP for runtime React layout: creates ownership conflicts with Motion and recommendation state.
- Motion for authored character narrative: would require timer/state orchestration or per-character React updates.
- Rive without a reviewed asset: adds runtime cost but does not improve the actual state asset.
- Tone.js for existing short UI cues: the current Web Audio system is sufficient and avoids another runtime layer.
