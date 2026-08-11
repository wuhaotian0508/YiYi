# YiYi — a voice-first morning outfit assistant

## 1. What it is

YiYi is a voice-first morning outfit assistant for busy, fashion-conscious young people who get ready with their hands full and have no time to type or scroll through clothing options. You say what your day looks like — and optionally name a garment you already want to wear — and YiYi returns **one** complete outfit built from your own wardrobe, matched to today's local weather, your schedule, and your learned style preferences. You can then adjust single garments by voice ("swap the shoes", "warmer jacket") and everything you did not mention stays exactly as it was.

One decision, spoken. Not a grid of options to compare.

## 2. Deployed URL & how to run it

**Deployed URL:** `<TODO: paste the production URL here before the Tuesday, Aug 11 repo deadline>`

The deployed build runs in demo mode: pick the example wardrobe on the onboarding screen and you can run the full recommendation and revision loop without uploading any personal photos.

### Run it from a clean machine

Requirements: Node.js 20.9+ (Node 24 LTS recommended) and pnpm 11.

```bash
git clone <repo-url>
cd YiYi-Supabase
cp .env.example .env.local
pnpm install
pnpm dev
```

Open http://localhost:3000 on a narrow mobile viewport (or Chrome DevTools device mode).

Mock mode (`AI_MODE=mock`, `NEXT_PUBLIC_VOICE_MODE=mock`) is the default and needs **no provider credentials** — the full outfit pipeline, wardrobe, and revision flow all work offline. To run the live voice demo instead, set in `.env.local`:

```dotenv
AI_MODE=live
NEXT_PUBLIC_VOICE_MODE=live
OPENAI_API_KEY=sk-...
PHOTOROOM_API_KEY=...        # only needed for wardrobe photo import
```

Microphone permission is required for live voice. In production live mode, provider-backed routes also require Upstash REST credentials (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) and deliberately fail closed without them; the in-process rate limiter is development-only.

The competition build sets `NEXT_PUBLIC_WEATHER_MODE=fixed-demo`. `/api/weather` can normalize live Open-Meteo data when both coordinates are supplied, but the demo Today flow does not request device location and honestly reports its source as `fixed-demo`.

### Verify the build

```bash
pnpm verify     # lint + typecheck + unit tests + build
pnpm test:e2e   # Playwright, chromium + iPhone webkit, boots dev server in mock mode
```

## 3. How we used AI to build it

**We used AI to build the parts of the product that are genuinely language and vision problems.**
We used the **OpenAI Realtime API** (via the official `@openai/agents/realtime` SDK) to power continuous live voice dialogue and to extract structured daily-occasion intent from speech. We used **GPT-5.6 Terra** to generate structured attribute tags from wardrobe garment photos, one item at a time. We used **GPT-5.6 Sol** to visually score candidate outfit combinations — and Sol only ever receives garment IDs that our own deterministic code has already proven legal, so it ranks, it never invents.

**The AI got multilingual voice slot parsing wrong, so we rewrote it ourselves.**
Our first slot matcher was a single set of English word-boundary regexes (`/\b(shoes?|sneakers?|boots?)\b/`). Chinese has no word boundaries, so a command like "换鞋" matched nothing, the router fell through to `global_revision`, and a request to change one garment silently regenerated the entire outfit. We replaced it with an explicit Chinese term table ordered most-specific-first — 连衣裙 contains 裙, 运动鞋 contains 鞋, 包包 contains 包 — that runs ahead of the English path in `src/domain/recommendation/voice-action-router.ts`, so each language is matched on its own terms instead of one pattern trying to cover both.

**We wrote the deterministic core ourselves, because correctness here is not a thing you can prompt for.**
All of the following is hand-written TypeScript: weather legality validation, the frozen-slot lock that preserves every unmentioned garment during a targeted revision, versioned outfit history and undo, Zod v4 schemas validating every external input and every AI output, and the silent fallback path that always yields one wearable outfit when a provider call fails. We wrote it ourselves because generated code could not be relied on to enforce these constraints consistently, and because the failure mode we cared most about — a half-finished or illegal outfit shown to a real user — is exactly the failure a probabilistic model will produce occasionally and confidently.

## 4. What it does not do yet

- **No batch wardrobe import.** Photos are added one at a time; there is no multi-select bulk upload.
- **No full screen-reader accessibility.** The voice dock is not yet fully navigable for blind and low-vision users.

We made that call deliberately. Within a fixed cloud-API budget and timeline, we chose to spend the remaining time fixing the voice recognition bugs above and polishing the single-outfit recommendation loop until it was reliable, rather than shipping a wider surface with a shaky core. Both limits are real, and both are the first things on the roadmap.

## 5. What we would build next

1. **Multi-item batch wardrobe upload**, so a new user can set up a real wardrobe in one sitting instead of one photo at a time.
2. **Full voice-dock accessibility**, so the interaction model that is already hands-free becomes genuinely usable eyes-free.
3. **One line of transparent reasoning under every recommendation** — a single sentence explaining how weather, occasion, and personal style produced this outfit, so the user can trust or correct the decision instead of just accepting it.

## Architecture

Zod schemas are the canonical contracts; TypeScript types are inferred from them, never hand-duplicated. One constraint-first decision pipeline merges the daily context, starts its search from required and preserved anchors, generates legal separates-or-one-piece templates, scores them on context / personalization / compatibility / comfort / novelty, and owns versioned revisions and undo. GPT-5.6 Terra analyzes one normalized item cutout; GPT-5.6 Sol visually evaluates only the legal candidates it is handed; the Realtime session emits validated structured deltas through the official Agents SDK. Multiple candidates exist only inside the short-lived ranking step and are discarded before display — the user is never asked to compare options.

Wardrobe data, including all garment images, stays local in Dexie/IndexedDB and never leaves the device.

See `ARCHITECTURE.md`, `API_CONTRACTS.md`, and `DATA_MODEL.md` for the full contracts.

## Optional Supabase sync

Wardrobe image Blobs always stay in Dexie/IndexedDB. Optional Supabase Magic Link sign-in syncs only wardrobe *metadata*, preferences, and outfit history between devices. Apply `supabase/migrations/20260722190000_create_yiyi_cloud_sync.sql`, point Supabase Auth Site/redirect URLs at the deployed site, and set these Vercel variables for Production, Preview, and Development:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Never use a service-role key in browser or public Vercel variables. Signed-out YiYi remains fully local and fully functional.

## Shopify purchase import

From `Wardrobe → Add clothes`, signed-in users can choose **Import purchases from Shopify**. YiYi finds paid Shopify orders using the verified account email, shows product images and metadata, and lets the user select up to eight items. Imported images become local wardrobe files; product type and Shopify tags are carried in as editable suggestions.

Shopify credentials stay server-side. The import fails closed when the store integration or rate limiter is not configured. The implementation is split across `src/components/wardrobe/shopify-purchase-import.tsx`, the Shopify API routes under `src/app/api/wardrobe/shopify/`, and the server/client helpers under `src/lib/shopify/` and `src/lib/wardrobe/shopify-client.ts`.

## Provenance

Built clean-room in a new repository. Asset provenance is recorded in `ASSET_ATTRIBUTION.md`.

## Repository structure

This tree mirrors the tracked product, source, asset, configuration, and test files in the current GitHub branch; each listed file has a responsibility note. Process-only planning and design Markdown is intentionally omitted.

```text
YiYi/
├── .agents/
│   └── skills/
│   │   ├── animation-vocabulary/
│   │   │   └── SKILL.md — skill instructions
│   │   ├── apple-design/
│   │   │   └── SKILL.md — skill instructions
│   │   ├── emil-design-eng/
│   │   │   └── SKILL.md — skill instructions
│   │   ├── find-animation-opportunities/
│   │   │   └── SKILL.md — skill instructions
│   │   ├── improve-animations/
│   │   │   ├── AUDIT.md — animation audit
│   │   │   ├── PLAN-TEMPLATE.md — audit plan template
│   │   │   └── SKILL.md — skill instructions
│   │   └── ui-sound-design/
│   │   │   ├── assets/
│   │   │   │   └── sound-preview.html — skill support asset
│   │   │   ├── references/
│   │   │   │   ├── audio-file-references.md — audio design reference
│   │   │   │   ├── audio-rules.md — audio design reference
│   │   │   │   ├── sound-recipes.md — audio design reference
│   │   │   │   ├── tone-js.md — audio design reference
│   │   │   │   └── web-audio-api.md — audio design reference
│   │   │   ├── SKILL.md — skill instructions
│   │   │   └── tools/
│   │   │   │   └── analyze-sound.mjs — audio analysis tool
├── .env.example — environment-variable template
├── .github/
│   └── workflows/
│   │   └── ci.yml — repository file
├── .gitignore — Git ignore rules
├── 参考图/
│   ├── YiYi_1.png — reference image
│   ├── YiYi_2.png — reference image
│   └── YiYi_3.png — reference image
├── AGENTS.md — repository instructions
├── API_CONTRACTS.md — API contracts
├── ARCHITECTURE.md — system architecture
├── ASSET_ATTRIBUTION.md — asset provenance record
├── CODEX_KICKOFF_PROMPT.md — Codex kickoff prompt
├── DATA_MODEL.md — data model
├── eslint.config.mjs — ESLint configuration
├── next-env.d.ts — Next.js generated declarations
├── next.config.ts — Next.js configuration
├── package.json — scripts and dependencies
├── playwright.config.ts — Playwright E2E configuration
├── playwright.live.config.ts — live-provider Playwright configuration
├── playwright.motion.config.ts — motion-review Playwright configuration
├── pnpm-lock.yaml — locked dependencies
├── pnpm-workspace.yaml — pnpm workspace settings
├── postcss.config.mjs — PostCSS configuration
├── PRODUCT_SPEC.md — product requirements
├── public/
│   ├── brand/
│   │   └── yiyi-mark.svg — public image or brand asset
│   ├── demo-wardrobe/
│   │   ├── wardrobe-sprite.webp — public image or brand asset
│   │   └── white-sneakers-clean.webp — public image or brand asset
│   └── style-calibration/
│   │   ├── style-grid-menswear.webp — public image or brand asset
│   │   ├── style-grid.webp — public image or brand asset
│   │   ├── v2/
│   │   │   ├── manifest.json — calibration asset manifest
│   │   │   ├── pair-classic-trend.webp — public image or brand asset
│   │   │   ├── pair-fitted-oversized.webp — public image or brand asset
│   │   │   ├── pair-minimal-expressive.webp — public image or brand asset
│   │   │   ├── pair-relaxed-polished.webp — public image or brand asset
│   │   │   ├── pair-soft-utility.webp — public image or brand asset
│   │   │   └── pair-tonal-graphic.webp — public image or brand asset
│   │   └── v3/
│   │   │   ├── manifest.json — calibration asset manifest
│   │   │   ├── neutral/
│   │   │   │   ├── pair-classic-trend.webp — public image or brand asset
│   │   │   │   ├── pair-fitted-oversized.webp — public image or brand asset
│   │   │   │   ├── pair-minimal-expressive.webp — public image or brand asset
│   │   │   │   ├── pair-relaxed-polished.webp — public image or brand asset
│   │   │   │   ├── pair-soft-utility.webp — public image or brand asset
│   │   │   │   └── pair-tonal-graphic.webp — public image or brand asset
│   │   │   └── womenswear/
│   │   │   │   ├── pair-classic-trend.webp — public image or brand asset
│   │   │   │   ├── pair-fitted-oversized.webp — public image or brand asset
│   │   │   │   ├── pair-minimal-expressive.webp — public image or brand asset
│   │   │   │   ├── pair-relaxed-polished.webp — public image or brand asset
│   │   │   │   ├── pair-soft-utility.webp — public image or brand asset
│   │   │   │   └── pair-tonal-graphic.webp — public image or brand asset
├── README_PACKAGE.md — starter-package contents
├── README.md — project overview and repository map
├── release-audit/
│   ├── 00-baseline/
│   │   ├── rc-baseline.json — release audit evidence
│   │   └── README.md — project overview and repository map
│   ├── 01-correctness/
│   │   ├── before-after.md — release audit evidence
│   │   ├── failing-counterexamples/
│   │   │   └── voice-failure-without-state.json — release audit evidence
│   │   ├── invariants.md — release audit evidence
│   │   └── test-results.json — release audit evidence
│   ├── 02-recommendation/
│   │   ├── before-after.md — release audit evidence
│   │   ├── eval-runner.ts — release audit evidence
│   │   ├── failures.jsonl — release audit evidence
│   │   ├── fixtures/
│   │   │   └── eval-v1.json — release audit evidence
│   │   └── metrics.json — release audit evidence
│   ├── 03-performance/
│   │   ├── before-after.md — release audit evidence
│   │   ├── bundle-after/
│   │   │   └── summary.json — release audit evidence
│   │   ├── bundle-before/
│   │   │   └── summary.json — release audit evidence
│   │   ├── memory-lifecycle.md — release audit evidence
│   │   ├── react-profile.json — release audit evidence
│   │   └── route-dependency-matrix.json — release audit evidence
│   ├── 04-resilience/
│   │   ├── before-after.md — release audit evidence
│   │   ├── cost-budgets.json — release audit evidence
│   │   ├── failures.jsonl — release audit evidence
│   │   ├── fault-matrix.json — release audit evidence
│   │   └── load-tests/
│   │   │   └── mock-api-baseline.json — release audit evidence
│   ├── 05-trust/
│   │   ├── asvs-mapping.tsv — release audit evidence
│   │   ├── axe-results.json — release audit evidence
│   │   ├── before-after.md — release audit evidence
│   │   ├── privacy-data-flow.md — release audit evidence
│   │   └── threat-model.md — release audit evidence
│   └── 06-release/
│   │   ├── device-validation-checklist.md — release audit evidence
│   │   ├── known-limitations.md — release audit evidence
│   │   ├── observability.md — release audit evidence
│   │   ├── release-readiness.json — release audit evidence
│   │   ├── rollback.md — release audit evidence
│   │   └── secret-scan.mjs — release audit evidence
├── scripts/
│   ├── build-release-archive.d.mts — verification or release script
│   ├── build-release-archive.mjs — verification or release script
│   ├── verify-realtime-tool-lifecycle.mjs — verification or release script
│   └── verify-sharp-runtime.mjs — verification or release script
├── skills-lock.json — locked skills metadata
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── diagnostics/
│   │   │   │   └── wardrobe-save/
│   │   │   │   │   └── route.ts — Next.js API route
│   │   │   ├── health/
│   │   │   │   ├── image/
│   │   │   │   │   └── route.ts — Next.js API route
│   │   │   │   └── route.ts — Next.js API route
│   │   │   ├── outfits/
│   │   │   │   └── rank/
│   │   │   │   │   └── route.ts — Next.js API route
│   │   │   ├── realtime/
│   │   │   │   └── token/
│   │   │   │   │   └── route.ts — Next.js API route
│   │   │   ├── voice/
│   │   │   │   └── interpret/
│   │   │   │   │   └── route.ts — Next.js API route
│   │   │   ├── wardrobe/
│   │   │   │   ├── process/
│   │   │   │   │   └── route.ts — Next.js API route
│   │   │   │   └── shopify/
│   │   │   │   │   ├── image/
│   │   │   │   │   │   └── route.ts — Next.js API route
│   │   │   │   │   └── purchases/
│   │   │   │   │   │   └── route.ts — Next.js API route
│   │   │   └── weather/
│   │   │   │   └── route.ts — Next.js API route
│   │   ├── calibration-lab/
│   │   │   └── page.tsx — app route page
│   │   ├── globals.css — global styles
│   │   ├── layout.tsx — root layout and providers
│   │   ├── manifest.ts — web manifest
│   │   ├── motion-review/
│   │   │   └── page.tsx — app route page
│   │   ├── onboarding/
│   │   │   └── page.tsx — app route page
│   │   ├── page.tsx — app route page
│   │   ├── preferences/
│   │   │   └── page.tsx — app route page
│   │   ├── settings/
│   │   │   └── page.tsx — app route page
│   │   ├── sign-in/
│   │   │   └── page.tsx — app route page
│   │   ├── today/
│   │   │   └── page.tsx — app route page
│   │   └── wardrobe/
│   │   │   ├── [itemId]/
│   │   │   │   └── page.tsx — app route page
│   │   │   ├── add/
│   │   │   │   └── page.tsx — app route page
│   │   │   └── page.tsx — app route page
│   ├── components/
│   │   ├── app-route-gate.tsx — reusable UI component
│   │   ├── brand/
│   │   │   └── yiyi-mark.tsx — reusable UI component
│   │   ├── calibration/
│   │   │   ├── calibration-lab-disabled.tsx — reusable UI component
│   │   │   ├── calibration-lab.module.css — reusable UI component
│   │   │   ├── calibration-lab.tsx — reusable UI component
│   │   │   ├── onboarding-calibration.module.css — reusable UI component
│   │   │   └── onboarding-calibration.tsx — reusable UI component
│   │   ├── cloud/
│   │   │   └── cloud-sign-in-form.tsx — reusable UI component
│   │   ├── motion/
│   │   │   ├── frame-sampler.tsx — reusable UI component
│   │   │   ├── motion-provider.tsx — reusable UI component
│   │   │   ├── motion-review-client.module.css — reusable UI component
│   │   │   ├── motion-review-client.tsx — reusable UI component
│   │   │   └── motion-review-disabled.tsx — reusable UI component
│   │   ├── onboarding/
│   │   │   ├── conversational-onboarding.module.css — reusable UI component
│   │   │   └── conversational-onboarding.tsx — reusable UI component
│   │   ├── outfit/
│   │   │   └── outfit-canvas.tsx — reusable UI component
│   │   ├── preferences/
│   │   │   └── fine-tune-voice.tsx — reusable UI component
│   │   ├── settings/
│   │   │   └── cloud-sync-settings.tsx — reusable UI component
│   │   ├── ui/
│   │   │   ├── bottom-sheet.tsx — reusable UI component
│   │   │   └── buttons.tsx — reusable UI component
│   │   ├── voice/
│   │   │   ├── editable-voice-transcript.tsx — reusable UI component
│   │   │   └── voice-core.tsx — reusable UI component
│   │   └── wardrobe/
│   │   │   ├── garment.tsx — reusable UI component
│   │   │   ├── shopify-purchase-import.tsx — signed-in Shopify purchase picker (up to eight items)
│   │   │   └── wardrobe-panel.tsx — reusable UI component
│   ├── content/
│   │   └── copy.ts — centralized product copy
│   ├── domain/
│   │   ├── preferences/
│   │   │   ├── calibration-catalog.ts — preference-domain logic
│   │   │   ├── calibration-engine.ts — preference-domain logic
│   │   │   ├── calibration.ts — preference-domain logic
│   │   │   ├── defaults.ts — preference-domain logic
│   │   │   ├── explicit-options.ts — preference-domain logic
│   │   │   ├── feedback.ts — preference-domain logic
│   │   │   ├── preference-matching.ts — preference-domain logic
│   │   │   ├── profile-mutations.ts — preference-domain logic
│   │   │   └── summary.ts — preference-domain logic
│   │   ├── recommendation/
│   │   │   ├── constraints.ts — recommendation-domain logic
│   │   │   ├── context.ts — recommendation-domain logic
│   │   │   ├── engine.ts — recommendation-domain logic
│   │   │   ├── scoring.ts — recommendation-domain logic
│   │   │   ├── search.ts — recommendation-domain logic
│   │   │   ├── situation.ts — recommendation-domain logic
│   │   │   ├── voice-action-router.ts — recommendation-domain logic
│   │   │   └── voice-intent.ts — recommendation-domain logic
│   │   ├── schemas/
│   │   │   └── index.ts — canonical Zod schemas
│   │   └── taxonomy/
│   │   │   └── index.ts — clothing taxonomy
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client-session.ts — API/provider helper
│   │   │   ├── crs-responses.ts — API/provider helper
│   │   │   ├── diagnostics.ts — API/provider helper
│   │   │   ├── provider-policy.ts — API/provider helper
│   │   │   ├── rate-limit.ts — API/provider helper
│   │   │   └── responses.ts — API/provider helper
│   │   ├── audio/
│   │   │   └── sound-system.ts — application library helper
│   │   ├── cloud/
│   │   │   ├── auth.ts — application library helper
│   │   │   ├── server-auth.ts — application library helper
│   │   │   ├── sign-in-prompt.ts — application library helper
│   │   │   ├── supabase-client.ts — application library helper
│   │   │   └── sync.ts — application library helper
│   │   ├── images/
│   │   │   ├── client-preprocess.ts — application library helper
│   │   │   ├── prepare-upload.ts — application library helper
│   │   │   └── sharp-runtime.ts — application library helper
│   │   ├── motion/
│   │   │   └── tokens.ts — application library helper
│   │   ├── preferences/
│   │   │   └── profile-storage.ts — application library helper
│   │   ├── realtime/
│   │   │   ├── audio-energy.ts — Realtime voice helper
│   │   │   ├── browser-voice-language.ts — Realtime voice helper
│   │   │   ├── config.ts — Realtime voice helper
│   │   │   ├── preference-voice-adapter.ts — Realtime voice helper
│   │   │   ├── voice-diagnostics.ts — Realtime voice helper
│   │   │   ├── voice-session-coordinator.ts — Realtime voice helper
│   │   │   ├── voice-session.ts — Realtime voice helper
│   │   │   └── voice-turn-controller.ts — Realtime voice helper
│   │   ├── recommendation/
│   │   │   ├── board-renderer.ts — application library helper
│   │   │   ├── client-ranking.ts — application library helper
│   │   │   ├── operation-controller.ts — application library helper
│   │   │   └── session-mutations.ts — application library helper
│   │   ├── shopify/
│   │   │   ├── admin.ts — server-side Shopify Admin GraphQL client
│   │   │   └── schemas.ts — validated Shopify purchase and media schemas
│   │   ├── storage/
│   │   │   └── db.ts — application library helper
│   │   ├── wardrobe/
│   │   │   ├── local-save-diagnostics.ts — application library helper
│   │   │   ├── process-client.ts — application library helper
│   │   │   └── shopify-client.ts — browser client for purchase listing and image download
│   │   └── weather/
│   │   │   └── client.ts — application library helper
│   ├── mocks/
│   │   └── wardrobe.ts — offline mock data
│   └── prompts/
│   │   └── realtime-agent.ts — Realtime agent prompt
├── supabase/
│   └── migrations/
│   │   └── 20260722190000_create_yiyi_cloud_sync.sql — Supabase migration
├── TECHNICAL_VERIFICATION_NOTES.md — technical verification notes
├── TEST_PLAN.md — test plan
├── tests/
│   ├── e2e/
│   │   ├── audit-regressions.spec.ts — end-to-end test
│   │   ├── core-flow.spec.ts — end-to-end test
│   │   ├── helpers/
│   │   │   └── seed-explicit-demo.ts — end-to-end test
│   │   ├── motion-review.spec.ts — end-to-end test
│   │   ├── motion-review.spec.ts-snapshots/
│   │   │   ├── calibration-reduced-390x844-webkit-motion-darwin.png — browser snapshot
│   │   │   ├── fine-tune-reduced-390x844-webkit-motion-darwin.png — browser snapshot
│   │   │   ├── onboarding-v2-complete-375x667-webkit-motion-darwin.png — browser snapshot
│   │   │   ├── onboarding-v2-complete-390x844-webkit-motion-darwin.png — browser snapshot
│   │   │   ├── onboarding-v2-complete-393x852-webkit-motion-darwin.png — browser snapshot
│   │   │   ├── onboarding-v2-complete-430x932-webkit-motion-darwin.png — browser snapshot
│   │   │   ├── onboarding-v2-reduced-complete-390x844-webkit-motion-darwin.png — browser snapshot
│   │   │   └── onboarding-v2-reduced-questions-390x844-webkit-motion-darwin.png — browser snapshot
│   │   ├── onboarding-gate.spec.ts — end-to-end test
│   │   ├── release-load.spec.ts — end-to-end test
│   │   ├── trust-a11y.spec.ts — end-to-end test
│   │   ├── visual-review.spec.ts — end-to-end test
│   │   └── visual-review.spec.ts-snapshots/
│   │   │   ├── today-confirmed-390x844-chromium-darwin.png — browser snapshot
│   │   │   ├── today-result-375x667-chromium-darwin.png — browser snapshot
│   │   │   ├── today-result-390x844-chromium-darwin.png — browser snapshot
│   │   │   ├── today-result-393x852-chromium-darwin.png — browser snapshot
│   │   │   └── today-result-430x932-chromium-darwin.png — browser snapshot
│   ├── fixtures/
│   │   └── soft-jacket.webp — test fixture
│   ├── golden/
│   │   ├── calibration-v2.json — golden fixture
│   │   └── recommendation-v3.json — golden fixture
│   ├── live/
│   │   └── realtime-live-smoke.spec.ts — live smoke test
│   ├── mocks/
│   │   └── server-only.ts — test mock server
│   ├── setup.ts — test setup
│   └── unit/
│   │   ├── add-wardrobe-shopify-flow.test.ts — unit/component test
│   │   ├── app-data-reset.test.ts — unit/component test
│   │   ├── audio-energy.test.ts — unit/component test
│   │   ├── audit-regressions.test.ts — unit/component test
│   │   ├── bottom-sheet.test.tsx — unit/component test
│   │   ├── browser-voice-language.test.ts — unit/component test
│   │   ├── calibration-golden.test.ts — unit/component test
│   │   ├── calibration.property.test.ts — unit/component test
│   │   ├── calibration.test.ts — unit/component test
│   │   ├── client-image-preprocess.test.ts — unit/component test
│   │   ├── cloud-auth.test.ts — unit/component test
│   │   ├── cloud-sync-settings.test.tsx — unit/component test
│   │   ├── cloud-sync.test.ts — unit/component test
│   │   ├── components.test.tsx — unit/component test
│   │   ├── crs-responses.test.ts — unit/component test
│   │   ├── editable-voice-transcript.test.tsx — unit/component test
│   │   ├── explicit-preference-options.test.ts — unit/component test
│   │   ├── fine-tune-voice.test.tsx — unit/component test
│   │   ├── image-runtime.test.ts — unit/component test
│   │   ├── motion-onboarding.test.tsx — unit/component test
│   │   ├── onboarding-calibration.test.tsx — unit/component test
│   │   ├── onboarding-preference-state.test.tsx — unit/component test
│   │   ├── onboarding-state.test.ts — unit/component test
│   │   ├── openai-realtime-adapter.test.ts — unit/component test
│   │   ├── outfit-canvas-profile.test.tsx — unit/component test
│   │   ├── preference-migration.test.ts — unit/component test
│   │   ├── preference-mutations.property.test.ts — unit/component test
│   │   ├── preference-mutations.test.ts — unit/component test
│   │   ├── preference-persistence.test.ts — unit/component test
│   │   ├── preference-summary.test.ts — unit/component test
│   │   ├── preference-voice-adapter.test.ts — unit/component test
│   │   ├── preferences-page.test.tsx — unit/component test
│   │   ├── provider-policy.test.ts — unit/component test
│   │   ├── provider-route-faults.test.ts — unit/component test
│   │   ├── ranking-api.test.ts — unit/component test
│   │   ├── rate-limit.test.ts — unit/component test
│   │   ├── recommendation-golden.test.ts — unit/component test
│   │   ├── recommendation-mutations.test.ts — unit/component test
│   │   ├── recommendation.property.test.ts — unit/component test
│   │   ├── recommendation.test.ts — unit/component test
│   │   ├── release-archive.test.ts — unit/component test
│   │   ├── release-recommendation-eval.test.ts — unit/component test
│   │   ├── schemas.test.ts — unit/component test
│   │   ├── server-auth.test.ts — unit/component test
│   │   ├── shopify-admin.test.ts — unit/component test
│   │   ├── shopify-purchase-import.test.tsx — unit/component test
│   │   ├── shopify-routes.test.ts — unit/component test
│   │   ├── today-voice-retry.test.tsx — unit/component test
│   │   ├── upload-boundary.test.ts — unit/component test
│   │   ├── upload-image.test.ts — unit/component test
│   │   ├── voice-dock.test.tsx — unit/component test
│   │   ├── voice-initial-intent.test.ts — unit/component test
│   │   ├── voice-interpret-route.test.ts — unit/component test
│   │   ├── voice-recommendation-semantics.test.ts — unit/component test
│   │   ├── voice-session-coordinator.test.ts — unit/component test
│   │   ├── voice-turn-controller.test.ts — unit/component test
│   │   ├── wardrobe-save-diagnostics.test.ts — unit/component test
│   │   ├── wardrobe-save.test.ts — unit/component test
│   │   └── weather-client.test.ts — unit/component test
├── tsconfig.json — TypeScript configuration
├── vitest.config.ts — Vitest configuration
├── YIYI_FINAL_CARPET_CODE_AUDIT_2026-07-21.md — final code audit
├── YIYI_MASTER_DEVELOPMENT_SPEC.md — master development specification
├── YiYi_Master_Product_Engineering_Spec.md — master product engineering specification
├── YIYI_MOTION_ACCEPTANCE.md — motion acceptance criteria
├── YIYI_MOTION_ARCHITECTURE_DECISION.md — motion architecture decisions
├── YIYI_MOTION_STORYBOARD.md — motion storyboard
├── YIYI_ONBOARDING_WEATHER_WARDROBE_DEEP_AUDIT.md — onboarding, weather, and wardrobe audit
├── YIYI_RECOMMENDATION_ENGINE_RESEARCH.md — recommendation-engine research
├── YIYI_STYLE_CALIBRATION_RESEARCH.md — style-calibration research
├── YIYI_THREE_CORE_PROBLEMS_DEEP_AUDIT.md — audit of the three core problems
└── YIYI_USER_TEST_DEEP_DIVE_2026-07-21.md — user-test findings
```
