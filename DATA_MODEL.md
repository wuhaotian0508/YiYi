# YiYi Data Model

Zod v4 schemas in `src/domain/schemas` are canonical. TypeScript types must be inferred rather than duplicated.

## Core records

- `WardrobeItem`: UUID, schema version, exact category/subtype, fixed colors, normalized materials/tags, pattern, fit, 1–5 warmth/formality/comfort, availability, per-feature confidence and provenance, demo/personal data provenance, internal description, timestamps.
- `ItemImageSet`: item ID, separate original/cutout/thumbnail/mask Blobs, dimensions, timestamps.
- `CalibrationResponse`: stable catalog/question ID, catalog version, one of `a | b | both | neither | skip`, the actual left-to-right `presentationOrder`, and provenance timestamp. One canonical response exists per question; edits replace it explicitly. Presentation order is optional only when reading records written before counterbalancing.
- `PreferenceSignal`: stable ID; structured attribute/value/label; `more | less | unknown` polarity; soft/hard strength; confidence; global, pair-relative, category, or contextual scope; optional categories/slots/combination values and semantic vector/tags; permanence; editability; `active | needs_review | deleted` status; and source provenance.
- `PreferenceProfile`: schema/origin/revision, descriptive wardrobe direction, canonical calibration responses and preference signals, confidence-shrunk six-axis style projection, up to four semantic anchors, compatibility projections, bounded evidence, and Demo/Personal provenance. More/Less note arrays, rules, and metals are derived compatibility fields when canonical signals exist; they are not independent truth sources.
- `DailyIntent`: activities and time, aesthetics, formality/comfort/photo/walking priorities, accumulated warmth/colorfulness/layering/structure biases, excluded/required categories and items, soft preferences, scoped temporary item rules, summary, confidence, and ambiguity.
- `IntentDelta`: validated operation, target/preserve slots, required/excluded IDs and categories, numeric adjustments, desired/undesired tags, scoped hard/soft temporary rules, raw evidence, confidence, and ambiguity.
- `Outfit`: one legal core structure, optional bag, optional jewelry, and at most one secondary accessory (`headwear`, `scarf`, `belt`, `eyewear`, `hair_accessory`, or `other_accessory`), plus deterministic score, concise trace-supported reason, source, and versioned `ScoreTrace` dimensions. This is the deliberate P0 0–1 secondary-accessory limit.
- `OutfitVersion`: parent version, changed/preserved IDs, revision request, timestamp.
- `DailySession`: local date key, draft/active/confirmed state, intent, weather snapshot, current version and current recommendation ID, displayed-version Undo stack IDs, session-shown outfit IDs, monotonic operation generation, timestamps. Legacy `alternativeIds` remains an empty migration-compatible field and is never used as product state.

## Exact categories

`top`, `bottom`, `one_piece`, `outerwear`, `shoes`, `bag`, `jewelry`, `headwear`, `scarf`, `belt`, `eyewear`, `hair_accessory`, `other_accessory`.

## Persistence

Dexie v6 tables: `wardrobeItems`, `itemImages`, `preferenceProfiles`, `dailySessions`, `outfitVersions`, `appSettings`, `processingJobs`. The table layout remains stable while migrations add session/version state and normalize preference semantics. v6 recognizes canned Demo provenance, upgrades canonical signal defaults, and retains legacy preferences without trustworthy provenance only as editable `needs_review` records with zero confidence; their legacy scoring projections are cleared or ignored. Metadata and image Blobs remain separate. Data URLs are never persisted.

Demo wardrobe IDs and provenance are explicit. Switching to Personal removes Demo items, images, sessions, versions, and canned Demo profile state while preserving canonical preferences with explicit personal provenance. A Demo baseline never becomes a Personal preference merely because it was displayed.

Resetting preferences always writes a neutral Personal profile, even while the example wardrobe is active. It never restores canned Demo More/Less assumptions.

## Memory rules

`more`, `less`, and `unknown` are separate evidence states. A relative loser, an omitted answer, and Skip are never negative evidence. `needs_review`, `deleted`, Unknown, contextual, and zero-confidence signals do not alter durable recommendation behavior.

Only explicit structured long-term language, a direct remember request, or sufficiently repeated cross-context evidence can activate durable preferences. One confirmation or a weather/day-driven revision remains contextual. Every durable signal carries provenance, confidence, scope, permanence, and editability; review-only prose stays visible for deletion or replacement but cannot silently score.
