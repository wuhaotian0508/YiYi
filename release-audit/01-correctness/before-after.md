# Before / after

| Risk | Before | After |
|---|---|---|
| Voice runtime failure without `state:error` | UI entered error but adapter remained active; Retry reused the failed session. | `onFailure` closes the generation-guarded active adapter; later duplicate state events are stale and harmless. |
| Same-base concurrent commit | Behavior existed but lacked forced evidence. | Permanent race test proves one winner, one `STALE_OPERATION`, and two total versions including the base. |
| Dexie interruption between version/session writes | Atomicity was assumed. | Injected failure proves the transaction leaves zero versions and zero sessions. |

No product semantics, retry limits, rate limits, or UI direction changed.
