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
→ deterministic hard filters and shortlist
→ legal outfit templates and scoring
→ diversity selection (maximum eight)
→ compact client-rendered candidate boards
→ Sol ranking
→ one main + two alternatives
→ deterministic fallback on any failure
```

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

The browser requests an ephemeral secret from `/api/realtime/token`, then connects a `RealtimeSession` with that secret. The official SDK manages WebRTC. Raw `RTCPeerConnection`, SDP, and long-lived server keys are forbidden in client code.

## Reliability and privacy

All external inputs and AI outputs are Zod-validated. Async work carries request IDs and cancellable rank/weather requests use `AbortController`. Images, base64, audio, secrets, full wardrobe contents, and sensitive freeform content are never logged. Responses API requests use `store: false`.

Token, image-processing, and ranking routes have a dependency-free per-instance rate-limit guard. A shared edge limiter can replace it for multi-instance production without changing route contracts.
