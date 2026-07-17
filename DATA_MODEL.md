# YiYi Data Model

Zod v4 schemas in `src/domain/schemas` are canonical. TypeScript types must be inferred rather than duplicated.

## Core records

- `WardrobeItem`: UUID, schema version, exact category/subtype, fixed colors, normalized materials/tags, pattern, fit, 1–5 warmth/formality/comfort, availability, confidence, internal description, timestamps.
- `ItemImageSet`: item ID, separate original/cutout/thumbnail/mask Blobs, dimensions, timestamps.
- `PreferenceProfile`: fixed six-axis style vector, hard avoids, soft preferences, metal preference, comfort/formality weights, bounded evidence.
- `DailyIntent`: activities and time, aesthetics, formality/comfort/photo/walking priorities, excluded/required categories and items, temporary preferences, summary.
- `Outfit`: legal category slots, deterministic score, concise reason.
- `OutfitVersion`: parent version, changed/preserved IDs, revision request, timestamp.
- `DailySession`: local date key, draft/active/confirmed state, intent, weather snapshot, current version and recommendation IDs, timestamps.

## Exact categories

`top`, `bottom`, `one_piece`, `outerwear`, `shoes`, `bag`, `jewelry`, `headwear`, `scarf`, `belt`, `eyewear`, `hair_accessory`, `other_accessory`.

## Persistence

Dexie v1 tables: `wardrobeItems`, `itemImages`, `preferenceProfiles`, `dailySessions`, `outfitVersions`, `appSettings`, `processingJobs`. Metadata and image Blobs remain separate. Data URLs are never persisted. The app requests persistent browser storage after onboarding and warns near 150MB, blocking new uploads around 200MB.

## Memory rules

Only explicit long-term language such as “always,” “never,” “usually,” “generally,” a direct remember request, or repeated evidence can update durable preferences. All stored memories remain visible, editable, and deletable.
