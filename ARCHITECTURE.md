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

### Style calibration and preference learning

Research alternatives, sources, rejected methods, and residual validity limits are recorded in `YIYI_STYLE_CALIBRATION_RESEARCH.md`.

```text
descriptive wardrobe direction (metadata only)
→ four base matched-pair questions
→ A / B / Both / Neither / Skip canonical response
→ confidence check and at most two optional follow-ups
→ provenance-bearing More / Less / Unknown signals
→ active-signal-only style vector and anchor projection
→ Fine-tune structured chips or strict Realtime PreferenceDelta
→ serialized canonical mutation and Dexie write
→ editable Profile review / Preferences memory
→ recommendation reads only active durable signals
```

The catalog, response schema, signal derivation, and profile projection are deterministic TypeScript. Fixed onboarding images are never sent to an AI for analysis. Canonical A/B semantics are independent from presentation: a session-stable seed alternates left/right order, the response stores that order, and edits reuse it. Wardrobe direction remains visible descriptive metadata and is excluded from recommendation summaries, constraints, and scoring. A/B losers stay Unknown, Skip adds no evidence, and unstructured prose is `needs_review` rather than an active rule. Demo data has explicit provenance; Demo-to-Personal cleanup cannot promote the canned profile into personal learning.

`/calibration-lab` is a non-persistent research surface. It compares pairwise and legacy single-card interaction, controlled mannequin and legacy model-photo presentation, A-left/B-left order, scripted response patterns, derived confidence/vector/signals, and deterministic recommendation counterfactuals. Production returns 404 unless `NEXT_PUBLIC_ENABLE_CALIBRATION_LAB=true`. The lab and automated invariance tests prove presentation order cannot change canonical profile semantics; they do not prove that residual synthetic-image or garment-covariance bias has been eliminated for people.

### Recommendation

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

One app-level `VoiceSessionCoordinator` owns the only token request, connect promise, adapter, microphone owner, lifecycle snapshot, and teardown promise. Today and Fine-tune use different agent contexts, but both acquire that same coordinator under the mutually exclusive `today | fine-tune` owner. They do not construct sessions from render, transcript, page phase, tool result, or recommendation state changes.

```text
explicit Voice Dock / Fine-tune tap
→ VoiceSessionCoordinator.start(owner)
→ reuse the owner's pending connect or healthy session when present
→ wait for any previous adapter teardown
→ create voiceAttemptId + sessionGeneration
→ adapter requests exactly one /api/realtime/token
→ construct strict tools, RealtimeAgent, and RealtimeSession
→ SDK opens WebRTC, microphone input, remote audio, and interruption handling
→ coordinator publishes one mutually exclusive lifecycle snapshot
→ generation-checked tool handler
→ version-checked recommendation / persistence mutation
→ SDK audio response and continued turns on the same session
→ explicit end, background, timeout, route cleanup, or runtime failure
→ unsubscribe listeners, invalidate generation, close SDK session, await teardown
```

The browser requests an ephemeral secret from `/api/realtime/token`, then connects a persistent `RealtimeSession` with that secret. The official SDK manages WebRTC. YiYi explicitly uses patient `semantic_vad` (`eagerness: low`) with automatic turn response and interruption enabled, so natural sentence pauses do not behave like a send button and user speech can barge into YiYi output. Pending token fetches are abortable; obsolete listener, transcript, and tool events are rejected by session generation. A committed Dexie mutation remains locked through local publish, while a still-preparing mutation can be cancelled. Raw `RTCPeerConnection`, SDP, media-track plumbing, audio playback buffers, and long-lived server keys are forbidden in client code.

The lifecycle snapshot is the sole source for `idle | connecting | listening | thinking | speaking | interrupted | error | rate_limited`. Today's recommendation phase remains separate and cannot imply connection health. A 429 enters `rate_limited`, honors `Retry-After`, and requires an explicit user retry after the cooldown; YiYi has no automatic reconnect timer. Diagnostics correlate only safe fields such as attempt, generation, owner, stage, result, duration, retry count, status, SDK status, and disconnect reason.

## Reliability and privacy

All external inputs and AI outputs are Zod-validated. Async work carries request IDs and cancellable rank/weather requests use `AbortController`. Images, base64, audio, secrets, full wardrobe contents, and sensitive freeform content are never logged. Responses API requests use `store: false`.

Provider diagnostics are structured and request-ID correlated. Only route/provider/model, status category, latency, safe error type/code, and aggregate usage totals are logged.

Token, image-processing, and ranking routes use Upstash REST when configured and otherwise report `per-instance` protection. Production live-provider routes fail closed unless the distributed limiter is actually configured; the in-process map is only a local-development guard. Vercel Firewall rules may add defense in depth, but no environment assertion can impersonate verified platform protection.
