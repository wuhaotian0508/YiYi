# Release invariants

| Boundary | Invariant | Evidence |
|---|---|---|
| Voice | One active owner, token request, connect promise, and microphone session; stale generations cannot publish; terminal failure always releases resources. | `voice-session-coordinator.test.ts`, `openai-realtime-adapter.test.ts` |
| Recommendation operation | Only one operation crosses commit/publish; preparing work may abort, committed work cannot be displaced before publish. | `recommendation-mutations.test.ts` |
| Persistence | OutfitVersion and DailySession commit atomically with generation/base-version CAS; an interrupted transaction leaves neither half. | concurrent-commit and interrupted-write regression tests |
| Revision/history | Targeted revision preserves every non-target slot; Undo restores the exact valid persisted parent. | recommendation property and mutation tests |
| Availability | Laundry/unavailable items cannot enter a new or restored outfit. | recommendation constraint and restore tests |
| Profile/calibration | Skip, unknown, review-only, contextual, and provenance-free legacy evidence cannot become an active hard avoid. | calibration/preference property and migration tests |
| UI lifecycle | Voice terminal states are mutually exclusive with listening/speaking; obsolete listeners and callbacks are generation-gated and cleaned. | coordinator, adapter, Today retry, and motion interruption tests |

The browser cannot provide cross-tab serializable UI state. Dexie transactions plus persisted `operationGeneration` and `currentVersionId` form the authoritative cross-tab CAS; losing tabs must reload the persisted winner instead of publishing stale state.
