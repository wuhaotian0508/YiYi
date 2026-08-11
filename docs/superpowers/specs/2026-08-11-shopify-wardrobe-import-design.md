# Shopify purchase wardrobe import design

## Goal

Allow a signed-in YiYi user to import clothing they purchased from one configured Shopify store into their local YiYi wardrobe. The import is based on that user's paid Shopify order history, not on the store's full product catalog and not on a pasted product URL.

This is a convenience input for the existing personal wardrobe. It is not shopping, product synchronization, a retailer scraper, or access to another customer's purchases.

## Scope

The first implementation supports one configured Shopify Admin API store with `read_orders` and `read_products`. YiYi verifies the current Supabase session on the server, uses the verified user email to query matching Shopify orders, and returns only purchased line items that still have an accessible product image.

The user opens **Import purchases from Shopify** from the existing Add clothing screen, selects at most eight purchased product images, and reviews each image using the current YiYi processing and save steps.

Shopify product titles, product types, and up to three tags are descriptive suggestions only. They are never trusted as YiYi taxonomy, never sent to Terra as facts, and never written directly to a wardrobe item. Terra analysis validated by `WardrobeAnalysisSchema`, followed by the existing user review controls, remains authoritative.

The implementation does not create, update, delete, or synchronize Shopify products or orders. It does not persist a Shopify token, customer ID, order ID, product ID, media ID, Shopify URL, external image URL, or Data URL.

## Configuration and trust boundary

The application server reads these server-only environment values:

```dotenv
SHOPIFY_STORE_DOMAIN=yiyi-wardrobe-lab.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=<entered directly in the environment>
```

`SHOPIFY_ADMIN_ACCESS_TOKEN` is never sent to the browser, logged, returned by an API, committed, or requested in chat. The health route may expose a boolean Shopify configuration state only.

The browser sends its Supabase access token only to YiYi's same-origin purchase and image routes. The server validates that token with Supabase and uses the returned verified email for Shopify order filtering. A missing, expired, or email-less session receives a structured 401 response. Local-only or signed-out users are directed to YiYi Magic Link sign-in before purchase history can be viewed.

YiYi's server makes authenticated Shopify requests. The browser receives validated purchase metadata plus opaque Shopify GraphQL identifiers needed to request an image. Shopify CDN URLs never reach the browser. The image route re-fetches the product/media relationship from Shopify, downloads bounded bytes, and returns those bytes with `Cache-Control: no-store`; the browser immediately creates a `Blob`.

## Verified test fixture

The configured development store contains Shopify customer `WuHaotian` and paid order `#1001`. The order contains these three $0 AI test products, one unit each:

- AI Test — Cream Button Jacket
- AI Test — Cream Knit Sweater
- AI Test — Black Tailored Trousers

Their images contain AI watermarks and must always be described as test images, not real clothing. The order is a free development-store fixture and does not represent a real charge or shipment.

## Product flow

1. The Add clothing page includes **Import purchases from Shopify** below the camera and library choices.
2. A signed-out user sees a concise sign-in requirement and a Magic Link link. No order data is requested before a valid session exists.
3. The importer lists distinct purchased products from matching paid Shopify orders. A compact card contains a server-fetched Blob thumbnail, product title, product type, purchase date, order name, and up to three tags.
4. The user selects one or more images, up to eight per import. Titles and tags remain temporary display suggestions only.
5. The client downloads each selected image through the authenticated image route. A failed download can be retried or skipped without discarding the other selected items.
6. Successfully downloaded image bytes enter the existing client preprocessing, `/api/wardrobe/process`, review, thumbnail generation, and `savePersonalWardrobeItem` flow.
7. YiYi displays one item review at a time. Saving advances to the next queued purchase; the app returns to Wardrobe only after the queue is complete.
8. Once saved, the item is a normal personal wardrobe item. No Shopify provenance or external identifier is persisted.

## Server API

Two same-origin Node.js routes sit behind server-only Supabase-auth and Shopify clients.

- `GET /api/wardrobe/shopify/purchases?cursor=<opaque>` validates `Authorization: Bearer <Supabase access token>`, queries orders by the verified email, and returns a Zod-validated bounded page plus an optional opaque Shopify cursor.
- `POST /api/wardrobe/shopify/image` validates the same session and a strict `{ productId, mediaId }` body. It re-fetches media ownership from Shopify, downloads one safe image, and returns raw image bytes.

The Shopify client uses version-pinned Admin GraphQL `2026-07`. It validates the minimum order, line-item, product, media, and page-info fields. It treats provider non-2xx, GraphQL errors, malformed response shapes, unavailable media, rate limits, and pagination failures as structured safe errors. Error responses and diagnostics never contain an email, token, query, Shopify response body, URL, product body, or image data.

Only recent orders available to the standard `read_orders` scope are required for P0. Importing older archived order history through `read_all_orders` is outside this implementation.

## Image safety

Before bytes reach the client, the image route enforces:

- media must belong to the requested product returned by the configured Shopify store;
- HTTPS only, no redirects, and Shopify CDN hosts only;
- JPEG, PNG, WebP, or HEIC only, verified from magic bytes rather than response headers;
- a 20 MB download cap, single-frame image, dimensions no larger than 12,000 per side, and at most 60 million pixels;
- no image bytes, URLs, product bodies, authorization headers, emails, or access tokens in diagnostics.

The client runs the existing `preprocessWardrobeImage` limits before uploading to `/api/wardrobe/process`. Saved `ItemImageSet` records continue to contain Blobs only.

## Error handling

The UI distinguishes sign-in required, unavailable Shopify configuration, no matching purchases, purchase listing failure, failed individual image download, and normal clothing-processing failure. A failed image never discards already downloaded selections. Retry is limited to the failed listing or download action; it never retries a Dexie save blindly.

## Testing and validation

Automated tests mock Supabase, Shopify GraphQL, and Shopify CDN image requests. They cover authentication absence, verified-email filtering, configuration absence, GraphQL pagination, schema rejection, provider errors, media-to-product ownership, redirect refusal, content-type and magic-byte mismatch, byte and pixel limits, and redaction-safe errors.

UI tests cover the Add clothing import entry, signed-out state, selection limit, suggestion-only display, download failure isolation, queue progression, and reuse of the existing review/save flow. No automated test calls Shopify, Supabase, Photoroom, or OpenAI live.

Live validation uses paid test order `#1001` in `yiyi-wardrobe-lab.myshopify.com`, then verifies each resulting local Dexie image record contains `Blob` values and no Shopify URL or Data URL.

## Decisions preserved

- English-only visible product copy.
- Existing iPhone-first capture/review visual system; purchase import is a compact third choice, not a shopping dashboard.
- Supabase Magic Link is optional for the rest of YiYi but mandatory for viewing account-specific purchase history.
- Local-first image privacy: Dexie stores only Blobs and metadata sync excludes image data.
- Read-only Shopify access and no live external calls in automated tests.
- Existing Zod schemas and the AI-plus-review process remain authoritative.
