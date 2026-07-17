# Codex Kickoff Prompt — YiYi Phase 0

You are starting a brand-new clean-room repository for YiYi.

## Goal

Complete **Phase 0 only**: inspect the specifications and UI references, initialize the engineering foundation, and create stable repository contracts. Do not implement live AI or business features yet.

## Mandatory context

Read, in this order:

1. `AGENTS.md`
2. `YIYI_MASTER_DEVELOPMENT_SPEC.md`
3. every image inside `参考图/`

This project is independent from the old `clothes-choosing` course project. Do not access, clone, copy, recreate, or adapt anything from that repository.

## Required work

1. Inspect the current workspace and report any existing files.
2. Initialize a new Next.js App Router project with:
   - strict TypeScript;
   - Tailwind CSS;
   - pnpm;
   - ESLint;
   - `src/` layout.
3. Install only the foundation dependencies needed now:
   - `zod` v4;
   - `dexie`;
   - `dexie-react-hooks`;
   - `zustand`;
   - `motion`;
   - `@openai/agents`;
   - official `openai` SDK;
   - `lucide-react` only if needed for reference-consistent icons.
4. Configure:
   - Vitest;
   - React Testing Library;
   - Playwright with Chromium and WebKit;
   - `typecheck`, `test`, `test:e2e`, and `verify` scripts.
5. Create the folder structure specified in the master document.
6. Split the stable material from the master document into:
   - `PRODUCT_SPEC.md`
   - `ARCHITECTURE.md`
   - `DATA_MODEL.md`
   - `API_CONTRACTS.md`
   - `TEST_PLAN.md`
   - `ASSET_ATTRIBUTION.md`
   Do not change product or architecture decisions while splitting.
7. Create `.env.example` exactly from the master spec, with no secrets.
8. Add central design tokens, iPhone safe-area primitives and the system font stack.
9. Add a minimal app shell and a health page or route sufficient to prove the scaffold works.
10. Add a CI workflow that runs lint, typecheck, unit tests and build.
11. Record the exact resolved package versions in the lockfile and summarize them in the completion report.

## Files allowed to change

This is an empty new repository, so you may create the foundation files and directories described above. Do not add product feature implementation beyond a minimal shell.

## Contracts that must not change

- iPhone-first web app.
- English visible product copy.
- No native app.
- No Express, Supabase, Firebase, Prisma or cloud DB.
- No raw WebRTC implementation.
- No authentication.
- No UI library such as shadcn.
- No old-project material.
- P0/P1/P2 scope from the master spec.

## Acceptance criteria

- `pnpm install` completes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm build` passes.
- Playwright can launch Chromium and WebKit against the minimal app.
- All six repository documents exist and agree with the master spec.
- `.env.example` exists and contains no real secret.
- The repository has no copied old-project content.
- The completion report lists files changed, commands run, exact results, and unresolved risks.

## Non-goals

Do not implement:

- splash/onboarding UI;
- Dexie data tables;
- image upload;
- Photoroom;
- OpenAI calls;
- Realtime voice;
- recommendation logic;
- demo wardrobe;
- production deployment.

## Working method

Before changing files, give a concise plan. After implementation, run all required checks. Do not suppress type or lint errors. Do not proceed to Phase 1 until I review the Phase 0 result.
