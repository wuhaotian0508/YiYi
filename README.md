# YiYi

YiYi is a continuous voice-first morning outfit assistant for OpenAI Build Week. Describe the day, not the clothes; YiYi decides one main outfit from the real wardrobe, offers two quieter alternatives, and revises only what the user asks to change.

## Local development

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Mock mode is the default and does not require provider credentials. Open http://localhost:3000 on a narrow mobile viewport.

The competition build intentionally uses fixed demo weather. `/api/weather` can normalize Open-Meteo data when coordinates are explicitly supplied, but the current Today flow does not request device location.

## Verification

```bash
pnpm verify
pnpm test:e2e
```

## Architecture

Zod schemas define the contracts. Deterministic domain code creates legal candidates and owns revisions/undo. GPT-5.6 Terra analyzes one item; GPT-5.6 Sol ranks only supplied legal candidates; OpenAI Realtime calls strict application tools through the official Agents SDK. Wardrobe data remains local in Dexie/IndexedDB.

The project was built clean-room in a new repository. Judges can use the included example wardrobe without uploading personal images.
