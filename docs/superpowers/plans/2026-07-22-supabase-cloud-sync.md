# Supabase Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace YiYi's local-only persistence with optional Magic Link sign-in and private Supabase synchronization for non-image data.

**Architecture:** Dexie stays the immediate local store and offline fallback. A cloud module owns optional configuration, auth, schema validation, JSONB row serialization, and last-updated-wins merge behavior. Settings is the only new product surface.

**Tech Stack:** Next.js 16, React 19, TypeScript, Dexie, Zod v4, Vitest, Supabase JS v2, Supabase Postgres/Auth/RLS, Vercel.

---

## Files

- Create: `supabase/migrations/20260722190000_create_yiyi_cloud_sync.sql`
- Create: `src/lib/cloud/supabase-client.ts`, `src/lib/cloud/auth.ts`, `src/lib/cloud/sync.ts`
- Create: `src/components/settings/cloud-sync-settings.tsx`
- Create: `tests/unit/cloud-sync.test.ts`, `tests/unit/cloud-auth.test.ts`, `tests/unit/cloud-sync-settings.test.tsx`
- Modify: `package.json`, `pnpm-lock.yaml`, `.env.example`, `src/lib/storage/db.ts`, `src/lib/preferences/profile-storage.ts`, `src/lib/recommendation/session-mutations.ts`, `src/lib/recommendation/operation-controller.ts`, `src/app/settings/page.tsx`, `src/app/globals.css`, `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `YIYI_MASTER_DEVELOPMENT_SPEC.md`

### Task 1: Define Supabase schema and configuration

**Files:** Create `supabase/migrations/20260722190000_create_yiyi_cloud_sync.sql`; modify `package.json`, `pnpm-lock.yaml`, `.env.example`; test `tests/unit/cloud-sync.test.ts`.

- [ ] **Step 1: Write a failing migration-shape test.**

```ts
it("creates RLS-protected user-scoped tables", async () => {
  const sql = await readFile("supabase/migrations/20260722190000_create_yiyi_cloud_sync.sql", "utf8");
  for (const table of ["yiyi_wardrobe_items", "yiyi_preference_profiles", "yiyi_daily_sessions", "yiyi_outfit_versions"]) {
    expect(sql).toContain(`create table public.${table}`);
    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain("auth.uid() = user_id");
  }
});
```

- [ ] **Step 2: Run `pnpm vitest run tests/unit/cloud-sync.test.ts` and observe ENOENT for the absent migration.**

- [ ] **Step 3: Add `@supabase/supabase-js` at `2.109.0`, run `pnpm install`, and add public-only variables to `.env.example`.**

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

- [ ] **Step 4: Write the migration.** Every table has `id`, `user_id references auth.users(id) on delete cascade`, JSONB `data`, bigint `updated_at`, a `(user_id, id)` primary key, `(user_id, updated_at desc)` index where rows are lists, RLS, and `for all using (auth.uid() = user_id) with check (auth.uid() = user_id)` policy. The tables are `yiyi_wardrobe_items`, `yiyi_preference_profiles` (`id text`), `yiyi_daily_sessions`, and `yiyi_outfit_versions`.

- [ ] **Step 5: Re-run the focused test; it must PASS, then commit with `git add package.json pnpm-lock.yaml .env.example supabase/migrations tests/unit/cloud-sync.test.ts && git commit -m "feat(storage): add Supabase cloud schema"`.**

### Task 2: Build and test the isolated cloud boundary

**Files:** Create `src/lib/cloud/supabase-client.ts`, `src/lib/cloud/auth.ts`, `src/lib/cloud/sync.ts`; test `tests/unit/cloud-auth.test.ts`, `tests/unit/cloud-sync.test.ts`.

- [ ] **Step 1: Write failing behavior tests before the modules.**

```ts
it("reports missing when a public variable is absent", () => {
  expect(cloudConfiguration({ url: "", key: "pk" })).toEqual({ configured: false, reason: "missing_configuration" });
});
it("keeps local data when timestamps are equal", () => {
  expect(preferNewest({ updatedAt: 10, value: "local" }, { updatedAt: 10, value: "remote" })).toEqual({ updatedAt: 10, value: "local" });
});
it("uses the provided origin for a Magic Link", async () => {
  await sendMagicLink("person@example.com", "https://yiyi.example.com");
  expect(signInWithOtp).toHaveBeenCalledWith({ email: "person@example.com", options: { emailRedirectTo: "https://yiyi.example.com" } });
});
```

- [ ] **Step 2: Run `pnpm vitest run tests/unit/cloud-auth.test.ts tests/unit/cloud-sync.test.ts`; expect unresolved `@/lib/cloud/*` imports.**

- [ ] **Step 3: Implement the smallest APIs.** `supabase-client.ts` creates a browser client only when both public variables exist. `auth.ts` exports `getCloudSession`, `subscribeToCloudAuth`, `sendMagicLink`, and `signOutCloud`; it rejects blank email, uses PKCE/session persistence, and never receives a secret. `sync.ts` exports this deterministic helper:

```ts
export function preferNewest<T extends { updatedAt: number }>(local: T, remote: T): T {
  return remote.updatedAt > local.updatedAt ? remote : local;
}
```

- [ ] **Step 4: Validate remote `data` through `WardrobeItemSchema`, `PreferenceProfileSchema`, `DailySessionSchema`, and `OutfitVersionSchema`; skip invalid rows. Make cloud rows `{ id, user_id, data, updated_at }`.**

- [ ] **Step 5: Run the two focused tests; expect PASS, then commit with `git add src/lib/cloud tests/unit/cloud-auth.test.ts tests/unit/cloud-sync.test.ts && git commit -m "feat(storage): add cloud auth and sync boundary"`.**

### Task 3: Synchronize after local commits without images

**Files:** Modify `src/lib/storage/db.ts`, `src/lib/preferences/profile-storage.ts`, `src/lib/recommendation/session-mutations.ts`, `src/lib/recommendation/operation-controller.ts`, `src/lib/cloud/sync.ts`; test `tests/unit/cloud-sync.test.ts`, `tests/unit/preference-persistence.test.ts`.

- [ ] **Step 1: Write failing local-first tests.**

```ts
it("keeps a wardrobe write local when sync is unavailable", async () => {
  await savePersonalWardrobeItem(item, images);
  expect(await db.wardrobeItems.get(item.id)).toEqual(item);
  expect(upsert).not.toHaveBeenCalled();
});
it("queues a user-scoped upsert after a local profile write", async () => {
  await savePreferences(profile); await flushCloudSync();
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", id: "default", data: profile }));
});
```

- [ ] **Step 2: Run `pnpm vitest run tests/unit/cloud-sync.test.ts tests/unit/preference-persistence.test.ts`; expect failure because sync scheduling does not exist.**

- [ ] **Step 3: Add `queueCloudSync()` and `bootstrapCloudSync()`.** The queue returns immediately when unconfigured or signed out; it reads only `wardrobeItems`, `preferenceProfiles`, `dailySessions`, and `outfitVersions`, never `itemImages`. Bootstrap pulls only the authenticated user, validates each row, picks `preferNewest`, and never deletes or overwrites an image record.

- [ ] **Step 4: Call `void queueCloudSync()` only after successful Dexie completion in `completeOnboarding`, `savePersonalWardrobeItem`, `finalizePersonalWardrobeMigration`, `seedWardrobe`, `seedPreferences`, `savePreferences`, `persistPreferenceDelta`, and the existing daily-session/outfit-version mutation transaction. Do not await it on the voice tool path.**

- [ ] **Step 5: Run `pnpm vitest run tests/unit/cloud-sync.test.ts tests/unit/preference-persistence.test.ts` and `pnpm test`; both must PASS. Commit with `git add src/lib/storage src/lib/preferences src/lib/recommendation src/lib/cloud tests/unit && git commit -m "feat(storage): sync records after local writes"`.**

### Task 4: Add optional Settings sign-in

**Files:** Create `src/components/settings/cloud-sync-settings.tsx`; modify `src/app/settings/page.tsx`, `src/app/globals.css`; test `tests/unit/cloud-sync-settings.test.tsx`.

- [ ] **Step 1: Write failing UI tests.**

```tsx
it("does not gate local YiYi when cloud configuration is missing", () => {
  render(<CloudSyncSettings status={{ configured: false, reason: "missing_configuration" }} />);
  expect(screen.getByText("Cloud sync is not configured.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Email me a sign-in link" })).not.toBeInTheDocument();
});
it("submits an optional Magic Link", async () => {
  render(<CloudSyncSettings status={{ configured: true, session: null }} />);
  await userEvent.type(screen.getByLabelText("Email address"), "person@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
  expect(sendMagicLink).toHaveBeenCalledWith("person@example.com", window.location.origin);
});
```

- [ ] **Step 2: Run `pnpm vitest run tests/unit/cloud-sync-settings.test.tsx`; expect a missing component import.**

- [ ] **Step 3: Implement English-only optional controls.** Use exactly `Cloud sync`, `Sign in to sync wardrobe details, preferences, and outfit history. Images stay on this device.`, `Email address`, `Email me a sign-in link`, `Signed in as`, and `Sign out`. Call `bootstrapCloudSync` after `SIGNED_IN`, render the group before Settings privacy copy, and update that copy to distinguish local image blobs from optional metadata sync.

- [ ] **Step 4: Run `pnpm vitest run tests/unit/cloud-sync-settings.test.tsx tests/unit/components.test.tsx` and `pnpm playwright test tests/e2e/trust-a11y.spec.ts`; both must PASS. Commit with `git add src/components/settings src/app/settings/page.tsx src/app/globals.css tests/unit/cloud-sync-settings.test.tsx && git commit -m "feat(settings): add optional cloud sync sign-in"`.**

### Task 5: Replace the former no-cloud contract and verify

**Files:** Modify `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `YIYI_MASTER_DEVELOPMENT_SPEC.md`; test `tests/unit/cloud-sync.test.ts`.

- [ ] **Step 1: Write a failing documentation assertion.**

```ts
it("documents optional Supabase Magic Link and public variables", async () => {
  const readme = await readFile("README.md", "utf8");
  expect(readme).toContain("optional Supabase Magic Link");
  expect(readme).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
});
```

- [ ] **Step 2: Run `pnpm vitest run tests/unit/cloud-sync.test.ts`; expect failure because README says data remains local.**

- [ ] **Step 3: Replace all contradictory rules with the approved boundary.** Dexie owns local cache and every image Blob; Supabase is optional RLS-protected non-image metadata sync. Document migration application, Supabase Auth Site/redirect URLs, and only the two `NEXT_PUBLIC_*` Vercel variables; explicitly prohibit service-role/private keys in browser variables.

- [ ] **Step 4: Run `pnpm lint; pnpm typecheck; pnpm test; pnpm build`; every command must exit 0. Commit with `git add AGENTS.md ARCHITECTURE.md README.md YIYI_MASTER_DEVELOPMENT_SPEC.md tests/unit/cloud-sync.test.ts && git commit -m "docs: replace local-only persistence contract"`.**

### Task 6: Provision the real Supabase and Vercel integration

**Files:** No repository change unless deployment URL documentation changes; test production Magic Link, sync, and RLS.

- [ ] **Step 1: Inspect dashboards.** Identify the Vercel project linked to `wuhaotian0508/YiYi`, its production domain, and an existing suitable Supabase project if one exists.
- [ ] **Step 2: Confirm the exact external write targets at action time.** State the Supabase organization, project name, region, Vercel project, production domain, and the two environment-variable names; receive confirmation before creation or configuration changes.
- [ ] **Step 3: Apply the committed migration once, set Supabase Site URL plus local/production redirect URLs, and configure Vercel Production/Preview/Development with only the project URL and publishable key.**
- [ ] **Step 4: Verify local-only use, Magic Link callback, same-account cross-browser readback of one non-image wardrobe item/profile/session, and RLS denial for another account. Do not record email, tokens, image data, or keys. Run `git push origin codex/yiyi-core`; expected: the production deployment is built from the pushed verified commit.**
