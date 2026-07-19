# YiYi Architecture

This contract is extracted from `YIYI_MASTER_DEVELOPMENT_SPEC.md`.

## Platform and stack

- Next.js App Router, React, strict TypeScript, Tailwind CSS, Motion
- Zod v4 as the canonical schema source
- Zustand for ephemeral UI and active-session state only
- Dexie/IndexedDB for wardrobe, images, preferences, sessions, versions, and jobs
- OpenAI official JS SDK and `@openai/agents/realtime`
- Photoroom Basic `/v1/segment`, Sharp normalization, Open-Meteo
- Vitest, React Testing Library, Playwright Chromium and WebKit
- Vercel Node.js runtime; mock services by default

## Ownership boundaries

Realtime owns dialogue, intent selection, strict tool calls, turn-taking, interruption, and concise spoken output. Deterministic domain code owns legality, availability, weather safety, candidate generation, preservation, version history, undo, persistence, and stale-response protection. Terra analyzes one normalized clothing cutout. Sol only ranks supplied legal candidate IDs.

## Main pipelines

```text
DailyIntent
→ validated IntentDelta merge (including scoped temporary rules)
→ one canonical RecommendationContext
→ required / preserved / focused anchors
→ separates or one-piece template selection
→ dynamic anchor-first beam search
→ canonical legality validation
→ context / personalization / compatibility / comfort / novelty ScoreTrace
→ MMR diversity selection (six; API ceiling eight)
→ compact client-rendered candidate boards
→ Sol visual scoring of every supplied legal ID
→ deterministic 70/30 score merge and one selected supplied candidate
→ canonical legality validation again
→ version-checked Dexie transaction
→ discard the request-scoped candidate pool
→ display one current answer
→ deterministic fallback on any failure
```

Initial, targeted, global, random, and fallback operations use this same context, constraint validator, search, and scoring path. Required items determine the search anchors before pruning. `top + bottom` and `onePiece` are mutually exclusive templates; a structural revision changes the core atomically. Random replacement excludes the current outfit and prefers session-unseen answers until they are exhausted. Targeted revision freezes every unmentioned present or empty slot. Undo restores an exact persisted version and never reveals a hidden alternative.

The P0 outfit schema supports an optional bag, optional jewelry, and one secondary accessory. Requiring two secondary accessories returns an explicit slot conflict instead of silently dropping one.

```text
native camera/library input
→ client MIME/size/orientation/resize validation
→ one item per server request
→ Photoroom transparent WebP
→ Sharp 1024×1024 normalization
→ Terra structured analysis
→ immediate Data URL to Blob conversion
→ separate Dexie metadata and image tables
```

## Realtime

The browser requests an ephemeral secret from `/api/realtime/token`, then connects a persistent `RealtimeSession` with that secret. The official SDK manages WebRTC. YiYi explicitly uses patient `semantic_vad` (`eagerness: low`) with automatic turn response and interruption enabled, so natural sentence pauses do not behave like a send button and user speech can barge into YiYi output. Pending token requests and obsolete SDK sessions are aborted or closed by a connection generation guard; events from an old session cannot mutate the active UI. Raw `RTCPeerConnection`, SDP, and long-lived server keys are forbidden in client code.

## Reliability and privacy

All external inputs and AI outputs are Zod-validated. Async work carries request IDs and cancellable rank/weather requests use `AbortController`. Images, base64, audio, secrets, full wardrobe contents, and sensitive freeform content are never logged. Responses API requests use `store: false`.

Provider diagnostics are structured and request-ID correlated. Only route/provider/model, status category, latency, safe error type/code, and aggregate usage totals are logged.

Token, image-processing, and ranking routes use Upstash REST when configured and otherwise report `per-instance` protection. Production live-provider routes fail closed unless the distributed limiter is actually configured; the in-process map is only a local-development guard. Vercel Firewall rules may add defense in depth, but no environment assertion can impersonate verified platform protection.
