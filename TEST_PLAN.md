# YiYi Test Plan

Automated tests run only against deterministic or mock services. Live Realtime, provider integrations, microphone interruption, native camera, and HEIC are manual real-device checks.

## Unit gates

Schemas, templates, one-piece substitution, shoes required, optional accessories, availability/exclusion/required-item filters, weather and walking safety, style vector, colors, diversity, targeted preservation, global revision bounds, undo, stale requests, intent-tag edits, memory rules, and rank-ID validation.

## Integration gates

First launch through onboarding, mock microphone, style calibration, example wardrobe, intent extraction, recommendation, targeted bag revision, confirmation, refresh recovery, image success, low confidence correction, and save.

## E2E gates

Chromium and WebKit cover the example-wardrobe loop, tag correction, targeted revision, rank fallback, upload failure, empty wardrobe, and iPhone safe-area screenshots at 375×667, 390×844, 393×852, and 430×932.

## Required milestone commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Before submission, run three consecutive live iPhone rehearsals and record Safari tab/Home Screen, microphone allow/deny, camera/library JPEG and HEIC, background/resume, interruption, safe areas, and IndexedDB recovery.
