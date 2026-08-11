# Shopify wardrobe import design

## Goal

Allow a YiYi user to select real products from one Shopify store they own or are explicitly authorized to use, then add selected product images through the existing YiYi clothing-processing and local-review flow.

This is a convenience input for the existing personal wardrobe. It is not shopping, product synchronization, a retailer scraper, or a way to import arbitrary public URLs.

## Scope

The first implementation supports one configured Shopify Admin API store with only the `read_products` scope. The user opens **Import from Shopify** from the existing Add clothing screen, selects at most eight product images, and reviews each image using the current YiYi processing and save steps.

Product titles and tags are shown only as editable suggestions. Terra analysis validated by `WardrobeAnalysisSchema`, followed by the existing user review controls, remains the authority for category, colors, materials, and recommendation inputs.

The implementation does not create, update, delete, or synchronize Shopify products. It does not show a text-chat alternative, persist a Shopify token, save an external image URL, or add a P2 shopping feature.

## Configuration and trust boundary

The application server reads the following server-only environment values:

```dotenv
SHOPIFY_STORE_DOMAIN=yiyi-wardrobe-lab.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=<entered directly by the user>
```

`SHOPIFY_ADMIN_ACCESS_TOKEN` is never sent to the browser, logged, returned by an API, committed, or requested in chat. The application health route may expose a boolean configuration state only.

YiYi's server makes the authenticated request to Shopify. The browser receives only validated product metadata and temporary image-selection descriptors. When the user chooses an image, the server retrieves it under strict image safety limits and sends safe image bytes to the browser, which immediately creates a `Blob`. Image URLs are not stored. The normal `/api/wardrobe/process` route continues to handle background removal and Terra analysis.

## Product flow

1. The Add clothing page includes a third secondary action: **Import from Shopify**.
2. The importer lists only configured-store products that have product media. A compact card contains title, product type, up to three tags, and a product thumbnail.
3. The user selects one or more images, up to eight per import. Product tags are descriptive hints only and are never written directly to a YiYi wardrobe item.
4. Selected image bytes enter the same client preprocessing, `/api/wardrobe/process`, review, thumbnail generation, and `savePersonalWardrobeItem` flow as a camera or library image.
5. YiYi displays one item review at a time. A user can discard any item or proceed to the next selected product image.
6. Once saved, the item is a normal personal wardrobe item. No Shopify source identifier, title, tag, or URL is required for recommendation behavior or persistence.

## Server API

Two same-origin Node.js routes sit behind a small server-only Shopify client.

- `GET /api/wardrobe/shopify/products?cursor=<opaque>` returns a Zod-validated, bounded page of product summaries and an optional opaque next cursor. It rejects missing configuration with a retryable configuration error and never exposes Shopify response bodies.
- `POST /api/wardrobe/shopify/image` accepts a validated Shopify product/media identifier pair. The server re-fetches the allowed media URL from Shopify rather than trusting a browser-supplied URL, then returns one bounded image response for immediate client Blob conversion.

The Shopify client uses a version-pinned Admin GraphQL request and validates the minimum needed product/media fields. It treats provider non-2xx, GraphQL errors, malformed response shapes, unavailable media, rate limits, and pagination failures as safe common API errors.

## Image safety

Before bytes reach the client, the image route enforces:

- media must belong to the requested product returned by the configured Shopify store;
- HTTPS only, no redirects, and a host allowlist derived from Shopify CDN media URLs returned by the Admin API;
- JPEG, PNG, WebP, or HEIC only, verified from magic bytes rather than response headers;
- bounded download size, dimensions, and pixel count aligned with the existing upload boundaries;
- no image bytes, URLs, product bodies, or authorization headers in diagnostics.

The client runs the existing `preprocessWardrobeImage` limits before uploading to `/api/wardrobe/process`. Saved `ItemImageSet` records continue to contain Blobs only.

## Error handling

The UI distinguishes unavailable configuration, empty product catalog, product listing failure, failed individual download, and normal clothing-processing failure. A failed image does not discard other selections. Retry is limited to the failed listing/download action; it never retries a save blindly.

## Testing and validation

Automated tests mock every Shopify GraphQL and CDN image request. They cover configuration absence, GraphQL pagination, schema rejection, provider errors, media-to-product ownership, redirect refusal, content-type/magic-byte mismatch, byte/pixel limits, and redaction-safe diagnostics.

UI tests cover the Add clothing import entry, selection limit, suggestion-only tag display, queue progression, and reuse of the existing review/save flow. No automated test calls Shopify, Photoroom, or OpenAI live.

Before release, the user enters the server-only token directly into the chosen local or Vercel environment. End-to-end validation uses a real user-owned product and image in `yiyi-wardrobe-lab.myshopify.com`, then verifies the resulting local Dexie item has Blob image records and editable review data. No Shopify-generated test catalog is used.

## Decisions preserved

- English-only visible product copy.
- The existing iPhone-first capture/review visual system; the import action is a compact third choice, not a separate dashboard.
- Local-first image privacy: Dexie stores only Blobs and metadata sync excludes image data.
- Read-only Shopify access and no live external calls in automated tests.
- Existing Zod schemas and the AI-plus-review process remain authoritative.
