# AGENTS.md — YiYi Repository Instructions

## Mission

Build YiYi, an iPhone-first continuous voice outfit assistant for OpenAI Build Week.

Read `YIYI_MASTER_DEVELOPMENT_SPEC.md` before making architectural or product changes. Inspect every image in `参考图/` before implementing UI.

## Non-negotiable product rules

- All visible product copy and voice output are English.
- The product is continuous live voice, not voice-message sending.
- Microphone permission is required for the core product.
- The user may describe their day, name one or more wardrobe anchors, or do both. Do not require them to construct the whole outfit; preserve explicitly requested available items unless a hard constraint conflicts.
- Show one decisive current recommendation. Multiple legal candidates are request-scoped ranking inputs, never exposed alternatives.
- Accessories are real recommendation inputs.
- Targeted revision must preserve every unmentioned item.
- Do not add a full text-chat fallback.
- Do not add features outside the frozen P0 scope.

## Clean-room rule

This repository is a new independent project.

- Do not copy, recreate, translate, or adapt code, UI, docs, prompts, schemas, tests, or assets from the previous `clothes-choosing` project.
- Do not clone the old repository into this workspace.
- Use only newly created or properly licensed assets.
- Keep asset provenance in `ASSET_ATTRIBUTION.md`.

## Frozen architecture

- Next.js App Router, React, strict TypeScript.
- Tailwind CSS and `motion`.
- Zustand only for ephemeral UI/session state.
- Dexie/IndexedDB for persistence.
- Zod v4 schemas are the canonical source of types.
- OpenAI official JS SDK and `@openai/agents/realtime`.
- Realtime browser flow uses `RealtimeAgent` + `RealtimeSession` + ephemeral client secret.
- Do not hand-write raw WebRTC/SDP unless a documented blocker is approved.
- `gpt-5.6-terra` analyzes one clothing item.
- Deterministic domain code creates legal candidates.
- `gpt-5.6` / Sol only ranks supplied candidates.
- Photoroom removes backgrounds.
- Vercel Node.js runtime; no Express, Supabase, Firebase or cloud database.
- Mock services by default.

## Engineering rules

- Validate every external input and AI output with Zod.
- Never expose an API key in client code.
- Never persist Data URLs; convert them to Blob.
- Never log image/base64/audio data.
- Centralize taxonomy and visible copy.
- Do not use `any` to bypass an SDK type.
- Do not refactor unrelated modules.
- Do not add a dependency without stating why.
- Do not implement P1/P2 while any P0 acceptance test is failing.
- Hide unfinished feature-flagged controls; never ship dead buttons.
- Automated tests must not call live external APIs.

## Task protocol

Before coding:

1. Read this file.
2. Read the relevant spec sections and contracts.
3. Inspect current files and reference images.
4. State a concise plan.
5. Flag any conflict before modifying code.

Every task response must include:

- goal;
- files changed;
- decisions preserved;
- tests run and exact results;
- remaining risks.

Run relevant tests and typecheck before declaring completion. For milestone work, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Do not claim success if any required command fails.

## Build Week evidence

Use one primary Codex thread for most core work. Maintain clean commits and document where Codex and GPT-5.6 are used. Before submission, run `/feedback` in the primary thread and record the Session ID.
