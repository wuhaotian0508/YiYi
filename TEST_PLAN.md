# YiYi Test Plan

Automated tests run only against deterministic or mock services. Live Realtime, provider integrations, microphone interruption, native camera, and HEIC are manual real-device checks.

## Unit and algorithm gates

Schemas, required-first anchors, mutually exclusive core templates, required accessories, availability/exclusion/hard-avoid/weather continuity across every operation, structured/scoped natural-language deltas, personalization direction, color/material/silhouette/formality/accessory scoring, recency decay, diversity, selected/scored-ID validation, targeted preservation of present and empty slots, atomic structure change, session random de-duplication, exact undo, stale base-version rejection, operation cancellation, confirmation atomicity, demo provenance cleanup, board limits, truthful source/model diagnostics, and memory rules.

Calibration unit, property, and versioned golden tests separately prove: the v2 catalog contract; A/B loser → Unknown; Both → positive without invented Less; Neither → explicit editable soft Less; Skip → no signal/confidence; all-positive and all-Skip profiles; bounded confidence/vector values; response-order independence and idempotence; A-left/B-left presentation invariance with recorded provenance; distinct profiles from equal feedback counts; stable provenance; explicit response editing; active versus review/deleted/contextual scoring boundaries; negative full-look evidence lowering matching-outfit personal fit without creating an opposite style vector; and canonical projection rebuild after edit/delete.

`fast-check` runs randomized wardrobe-signal invariants for canonical legality, required/excluded items, duplicate prevention, targeted preservation, reproducibility, and unseen-random preference. `tests/golden/recommendation-v3.json` is a versioned executable scenario registry. `fake-indexeddb` is test-only and exercises the real Dexie transaction code.

## Integration gates

First launch through the internal onboarding timelines, mock microphone, descriptive wardrobe direction, four base matched pairs with optional follow-ups and A/B/Both/Neither/Skip, structured More of/Less of, Fine-tune persistence, editable Profile review/undo, example or personal wardrobe, intent extraction, one recommendation, targeted/global/random revision, real-history undo, confirmation, refresh recovery, image success, low confidence correction, and save.

Preference persistence tests use the real fake-IndexedDB Dexie transaction path. They cover simultaneous chip/voice additions and deletion without lost writes, write failure without false success, navigation locked during a pending onboarding write, calibration Edit preserving explicit signals/evidence, final Profile/persisted-signal agreement, finish awaiting writes, and mutually exclusive Demo/Personal completion. Migration tests open real v1 and v5 databases, upgrade to v6, preserve trustworthy canonical provenance, quarantine unknown legacy values as zero-confidence Needs review, recognize canned Demo state, and verify idempotent reopening.

Realtime fault-injection tests use fake token and transport boundaries. They prove one token/connect for rapid or simultaneous starts, Strict Mode/remount stability, Today/Fine-tune microphone exclusion, pending-promise and healthy-session reuse, 429 cooldown, no automatic reconnect, disconnect-before-connect, teardown-before-replacement, stale-generation rejection, mutually exclusive error/listening UI, and listener/timer/session cleanup. Recommendation operations remain locked from Dexie commit through local publish so a stopped voice generation cannot publish a stale undo or availability repair.

## E2E gates

Chromium and WebKit cover the matched-pair onboarding/Fine-tune/Profile path, permission denial and retry, structured chips without raw-transcript display, Personal-mode Demo cleanup, the example-wardrobe loop, tag correction, single-answer semantics, targeted preservation, random replacement, undo, rank fallback, upload failure, empty personal wardrobe, and iPhone safe-area screenshots at 375×667, 390×844, 393×852, and 430×932. Playwright starts with `AI_MODE=mock` and `NEXT_PUBLIC_VOICE_MODE=mock` even when a developer has live values in `.env.local`.

`pnpm test:motion` runs the serial WebKit-only visual and interaction contract. It owns the versioned motion baselines so the general parallel Chromium/WebKit matrix does not generate duplicate engine-named snapshots or capture development toolbar chrome. It covers named onboarding frames, fixed-slot revision geometry, interruption, Bottom Sheet ownership, Today/Wardrobe gesture intent, Calibration/Fine-tune state motion, reduced motion, and the development frame sampler.

## Calibration research boundaries

Automated tests prove software semantics, not that a human answer is free from presentation bias. Runtime order is counterbalanced and recorded, and an executable counterfactual proves negative `style_look` evidence lowers the personal-fit score of a matching outfit without manufacturing an opposite style vector. The v2 manifest still retains source-render side confounds, synthetic rendering, mannequin proportions, cultural wardrobe coverage, and within-axis garment covariance as known risks. A human study is still required before claiming those perceptual biases are controlled.

The separately opted-in `playwright.live.config.ts` is not part of ordinary automation. When a developer deliberately provides live configuration, `pnpm exec playwright test --config=playwright.live.config.ts` uses Chromium's silent fake microphone to verify the real ephemeral-token and WebRTC ready path without semantic speech or tool calls. It asserts exactly one token request for Today and exactly one for Fine-tune, plus explicit cleanup/navigation release. It does not prove Safari permission UX, VAD, barge-in, audio routing, background recovery, or network handoff.

## Required milestone commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Before submission, run three consecutive live iPhone rehearsals and record Safari tab/Home Screen, microphone allow/deny, camera/library JPEG and HEIC, background/resume, interruption, safe areas, and IndexedDB recovery.
