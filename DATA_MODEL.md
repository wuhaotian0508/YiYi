# YiYi Data Model

Zod v4 schemas in `src/domain/schemas` are canonical. TypeScript types must be inferred rather than duplicated.

## Core records

- `WardrobeItem`: UUID, schema version, exact category/subtype, fixed colors, normalized materials/tags, pattern, fit, 1–5 warmth/formality/comfort, availability, per-feature confidence and provenance, demo/personal data provenance, internal description, timestamps.
- `ItemImageSet`: item ID, separate original/cutout/thumbnail/mask Blobs, dimensions, timestamps.
- `PreferenceProfile`: wardrobe direction, flexible like/dislike/skip signals, confidence-shrunk six-axis style vector, up to four semantic style anchors, balanced More of/Less of/freeform notes, hard avoids, soft preferences, metal preference, comfort/formality weights, bounded evidence, demo/personal provenance.
- `DailyIntent`: activities and time, aesthetics, formality/comfort/photo/walking priorities, accumulated warmth/colorfulness/layering/structure biases, excluded/required categories and items, soft preferences, scoped temporary item rules, summary, confidence, and ambiguity.
- `IntentDelta`: validated operation, target/preserve slots, required/excluded IDs and categories, numeric adjustments, desired/undesired tags, scoped hard/soft temporary rules, raw evidence, confidence, and ambiguity.
- `Outfit`: one legal core structure, optional bag, optional jewelry, and at most one secondary accessory (`headwear`, `scarf`, `belt`, `eyewear`, `hair_accessory`, or `other_accessory`), plus deterministic score, concise trace-supported reason, source, and versioned `ScoreTrace` dimensions. This is the deliberate P0 0–1 secondary-accessory limit.
- `OutfitVersion`: parent version, changed/preserved IDs, revision request, timestamp.
- `DailySession`: local date key, draft/active/confirmed state, intent, weather snapshot, current version and current recommendation ID, displayed-version Undo stack IDs, session-shown outfit IDs, monotonic operation generation, timestamps. Legacy `alternativeIds` remains an empty migration-compatible field and is never used as product state.

## Exact categories

`top`, `bottom`, `one_piece`, `outerwear`, `shoes`, `bag`, `jewelry`, `headwear`, `scarf`, `belt`, `eyewear`, `hair_accessory`, `other_accessory`.

## Persistence

Dexie v4 tables: `wardrobeItems`, `itemImages`, `preferenceProfiles`, `dailySessions`, `outfitVersions`, `appSettings`, `processingJobs`. v4 adds style anchors/profile provenance and session shown-set/operation generation while retaining existing local records. Metadata and image Blobs remain separate. Data URLs are never persisted. Demo IDs and provenance are stored explicitly; switching to personal mode removes demo items, demo profiles, and versions that reference demo state without deleting newly saved personal items. Settings include the persisted interface-sound switch.

## Memory rules

Only explicit long-term language such as “always,” “never,” “usually,” “generally,” a direct remember request, or repeated evidence can update durable preferences. All stored memories remain visible, editable, and deletable.
