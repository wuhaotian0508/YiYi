# YiYi Test Plan

Automated tests run only against deterministic or mock services. Live Realtime, provider integrations, microphone interruption, native camera, and HEIC are manual real-device checks.

## Unit and algorithm gates

Schemas, required-first anchors, mutually exclusive core templates, required accessories, availability/exclusion/hard-avoid/weather continuity across every operation, structured/scoped natural-language deltas, personalization direction, color/material/silhouette/formality/accessory scoring, recency decay, diversity, selected/scored-ID validation, targeted preservation of present and empty slots, atomic structure change, session random de-duplication, exact undo, stale base-version rejection, operation cancellation, confirmation atomicity, demo provenance cleanup, board limits, truthful source/model diagnostics, and memory rules.

`fast-check` runs randomized wardrobe-signal invariants for canonical legality, required/excluded items, duplicate prevention, targeted preservation, reproducibility, and unseen-random preference. `tests/golden/recommendation-v3.json` is a versioned executable scenario registry. `fake-indexeddb` is test-only and exercises the real Dexie transaction code.

## Integration gates

First launch through the internal onboarding timelines, mock microphone, wardrobe direction, flexible like/dislike/skip calibration, More of/Less of preferences, editable profile, example or personal wardrobe, intent extraction, one recommendation, targeted/global/random revision, real-history undo, confirmation, refresh recovery, image success, low confidence correction, and save.

## E2E gates

Chromium and WebKit cover the example-wardrobe loop, tag correction, single-answer semantics, targeted preservation, random replacement, undo, rank fallback, upload failure, empty personal wardrobe, and iPhone safe-area screenshots at 375×667, 390×844, 393×852, and 430×932. Playwright starts with `AI_MODE=mock` and `NEXT_PUBLIC_VOICE_MODE=mock` even when a developer has live values in `.env.local`.

## Required milestone commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Before submission, run three consecutive live iPhone rehearsals and record Safari tab/Home Screen, microphone allow/deny, camera/library JPEG and HEIC, background/resume, interruption, safe areas, and IndexedDB recovery.
