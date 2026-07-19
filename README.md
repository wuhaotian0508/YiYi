# YiYi

YiYi is a continuous voice-first morning outfit assistant for OpenAI Build Week. Describe the day, not the clothes; YiYi decides one clear outfit from the real wardrobe and revises only what the user asks to change. Multiple legal candidates exist only inside the short-lived ranking step, never as choices the user must compare.

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

Zod schemas define the contracts. One constraint-first TypeScript decision pipeline merges context, starts search from required/preserved anchors, generates legal separates or one-piece templates, scores context/personalization/compatibility/comfort/novelty, and owns versioned revisions and undo. GPT-5.6 Terra analyzes one item; GPT-5.6 Sol visually evaluates only supplied legal candidates; OpenAI Realtime emits validated structured deltas through the official Agents SDK. Wardrobe data remains local in Dexie/IndexedDB.

Production live-provider routes fail closed until distributed Upstash limits are configured. Per-instance limits are development-only; optional Vercel Firewall rules are defense in depth rather than an unverifiable code assertion.

The project was built clean-room in a new repository. Judges can use the included example wardrobe without uploading personal images.
