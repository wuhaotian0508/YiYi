# Shopify Purchase Wardrobe Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated **Import purchases from Shopify** flow that imports only the signed-in YiYi user's paid Shopify order items through the existing Blob, AI review, and Dexie save pipeline.

**Architecture:** A server-only Supabase verifier derives the current user's verified email from a bearer session. A version-pinned Shopify Admin GraphQL client reads matching order line items and re-resolves product media before a bounded CDN download. A focused client component presents purchased items and returns downloaded `File` objects to the existing Add clothing page, which processes and saves them sequentially without persisting Shopify identifiers or URLs.

**Tech Stack:** Next.js App Router, strict TypeScript, React 19, Zod v4, Supabase JS, Shopify Admin GraphQL 2026-07, Sharp, Vitest, Testing Library, Dexie.

---

### Task 1: Authenticate account-specific imports

**Files:**
- Create: `src/lib/cloud/server-auth.ts`
- Create: `tests/unit/server-auth.test.ts`

- [ ] **Step 1: Write failing server-auth tests**

Test that missing bearer auth returns `UNAUTHORIZED`, an invalid Supabase session returns `UNAUTHORIZED`, and a valid mocked `auth.getUser(token)` result returns a normalized verified email without exposing the access token.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm test -- tests/unit/server-auth.test.ts`

Expected: FAIL because `verifiedCloudUser` does not exist.

- [ ] **Step 3: Implement the minimal verifier**

Implement `verifiedCloudUser(request)` with strict bearer parsing, `cloudConfiguration()`, a non-persisting Supabase client, `auth.getUser(token)`, and a Zod email result. Return a discriminated union:

```ts
type VerifiedCloudUser =
  | { ok: true; email: string }
  | { ok: false; code: "UNAUTHORIZED" | "CLOUD_NOT_CONFIGURED" };
```

- [ ] **Step 4: Verify green**

Run: `pnpm test -- tests/unit/server-auth.test.ts`

Expected: PASS with no real Supabase request.

### Task 2: Read and validate Shopify purchase history

**Files:**
- Create: `src/lib/shopify/schemas.ts`
- Create: `src/lib/shopify/admin.ts`
- Create: `tests/unit/shopify-admin.test.ts`

- [ ] **Step 1: Write failing Shopify client tests**

Cover domain normalization, missing server configuration, `2026-07` endpoint and `X-Shopify-Access-Token` use, verified-email order query variables, cursor pagination, product/media flattening, duplicate purchased-product removal, empty tags, GraphQL errors, and malformed provider output. Mock `globalThis.fetch` in every case.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm test -- tests/unit/shopify-admin.test.ts`

Expected: FAIL because the Shopify schemas and client do not exist.

- [ ] **Step 3: Implement schemas and the GraphQL client**

Define strict Zod schemas for Shopify GraphQL envelopes and the browser-safe response:

```ts
export const ShopifyPurchaseSchema = z.object({
  productId: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/),
  mediaId: z.string().regex(/^gid:\/\/shopify\/MediaImage\/\d+$/),
  title: z.string().trim().min(1).max(200),
  productType: z.string().trim().max(100),
  tags: z.array(z.string().trim().min(1).max(80)).max(3),
  orderName: z.string().trim().min(1).max(40),
  purchasedAt: z.string().datetime(),
}).strict();
```

Implement `listPurchasedProducts({ email, cursor })` and `resolveProductMedia({ productId, mediaId })`. Keep the Admin token and provider URL inside the server module and throw bounded `ShopifyAdminError` codes without provider bodies.

- [ ] **Step 4: Verify green**

Run: `pnpm test -- tests/unit/shopify-admin.test.ts`

Expected: PASS; mocked fetch confirms no live network.

### Task 3: Add authenticated purchase and image routes

**Files:**
- Create: `src/app/api/wardrobe/shopify/purchases/route.ts`
- Create: `src/app/api/wardrobe/shopify/image/route.ts`
- Create: `tests/unit/shopify-routes.test.ts`
- Modify: `src/app/api/health/route.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing route tests**

Test 401 without a valid session, 503 without Shopify configuration, safe 502 mapping, bounded cursor parsing, media ownership rejection, HTTPS and CDN-host enforcement, redirect refusal, magic-byte detection, declared and streamed byte caps, Sharp dimension/pixel validation, no-store headers, and raw image success. Mock server auth, Shopify GraphQL, and CDN fetches.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm test -- tests/unit/shopify-routes.test.ts`

Expected: FAIL because both routes are missing.

- [ ] **Step 3: Implement the routes**

Use `verifiedCloudUser`, `takeRateLimit`, and structured `apiError` responses. The purchases route returns `{ requestId, purchases, nextCursor }`. The image route accepts only strict JSON `{ productId, mediaId }`, calls `resolveProductMedia`, downloads with `redirect: "manual"`, validates bytes and geometry, and returns a no-store `Response` with the detected MIME.

Add these server-only example variables:

```dotenv
SHOPIFY_STORE_DOMAIN=yiyi-wardrobe-lab.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=
```

Add `shopifyConfigured: boolean` to `/api/health`; never expose the domain or token.

- [ ] **Step 4: Verify green**

Run: `pnpm test -- tests/unit/shopify-routes.test.ts tests/unit/provider-route-faults.test.ts`

Expected: PASS with no external requests.

### Task 4: Build the purchase selector and Blob downloader

**Files:**
- Create: `src/components/wardrobe/shopify-purchase-import.tsx`
- Create: `src/lib/wardrobe/shopify-client.ts`
- Create: `tests/unit/shopify-purchase-import.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing component and client tests**

Mock `getCloudSession` and `fetch`. Cover signed-out sign-in CTA, empty purchase state, product title/type/empty tags display, selection toggling, eight-item limit, authenticated image requests, conversion of raw responses to `File`, one failed download alongside successful downloads, retry, and object-URL cleanup.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm test -- tests/unit/shopify-purchase-import.test.tsx`

Expected: FAIL because the component and client do not exist.

- [ ] **Step 3: Implement the selector**

Implement a compact iPhone-first list with English copy. The component accepts:

```ts
type ShopifyPurchaseImportProps = {
  onCancel(): void;
  onFiles(files: File[]): void;
};
```

Use the current Supabase access token in same-origin authorization headers, create Blob object URLs only for display, revoke them on replacement/unmount, and return only downloaded `File` objects to the parent. Do not return or store Shopify URLs.

- [ ] **Step 4: Verify green**

Run: `pnpm test -- tests/unit/shopify-purchase-import.test.tsx`

Expected: PASS with all Shopify and CDN behavior mocked.

### Task 5: Reuse the existing processing, review, and Dexie queue

**Files:**
- Modify: `src/app/wardrobe/add/page.tsx`
- Create: `tests/unit/add-wardrobe-shopify-flow.test.tsx`
- Modify: `tests/e2e/core-flow.spec.ts`

- [ ] **Step 1: Write failing flow tests**

Verify the Choose screen contains **Import purchases from Shopify**, selected downloaded files are processed one at a time through `preprocessWardrobeImage` and `/api/wardrobe/process`, saving the first item advances to the second review, the final save navigates to `/wardrobe`, and saved `ItemImageSet` values are Blobs with no Shopify fields or URL strings.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm test -- tests/unit/add-wardrobe-shopify-flow.test.tsx`

Expected: FAIL because the Add page has no Shopify step or queue.

- [ ] **Step 3: Implement the shared queue**

Extend `Step` with `"shopify"`, extract the existing one-file logic into a queue-aware `processFile(file, index, total)`, and make save advance to the next file before routing. Preserve the camera/library one-file path, current retry classifications, review controls, processing-job records, schema validation, idempotent save guard, and Dexie readback.

- [ ] **Step 4: Verify green**

Run: `pnpm test -- tests/unit/add-wardrobe-shopify-flow.test.tsx tests/unit/wardrobe-save.test.ts`

Expected: PASS with no live provider calls.

- [ ] **Step 5: Run the focused E2E mock flow**

Run: `pnpm exec playwright test tests/e2e/core-flow.spec.ts --project=chromium`

Expected: the existing camera/library mock flow and new import entry assertions pass.

### Task 6: Configure the development store and verify the milestone

**Files:**
- Modify locally only: `.env.local` (gitignored; token must never be printed)

- [ ] **Step 1: Update Shopify custom-app scopes**

In the Shopify admin, grant `read_orders` while retaining `read_products`. Do not add write scopes or `read_all_orders`.

- [ ] **Step 2: Generate and store the Admin API token**

Generate the custom-app token once and write it directly into `.env.local` with `SHOPIFY_STORE_DOMAIN`. Never echo the token, place it in tool output, or commit it.

- [ ] **Step 3: Run required repository verification**

Run, separately and read each complete result:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 4: Live local verification**

Start the app without printing environment values, sign in through the existing Magic Link session, open `/wardrobe/add`, import the three items from paid order `#1001`, and verify Dexie stores Blob image records only. Describe all three images as AI-watermarked test images.

- [ ] **Step 5: Inspect final scope**

Run `git status --short` and `git diff --check`. Confirm unrelated pre-existing dirty files are unchanged by this task and no secret or Shopify URL was added to tracked files.
