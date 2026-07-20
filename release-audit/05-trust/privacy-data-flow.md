# Privacy data flow

| Data | Stored | Sent externally | Log policy |
|---|---|---|---|
| Original/cutout/thumbnail image | Dexie blobs on this browser | selected original to Photoroom; normalized cutout to OpenAI Terra | never log bytes, URL or base64 |
| Candidate outfit board | request-only | legal candidate composites to OpenAI Sol | log only count, MIME, dimensions and bytes |
| Live audio/transcript | ephemeral browser/session state | OpenAI Realtime during an explicit live session | never log audio or transcript |
| Wardrobe metadata | Dexie | selected item prompt to Terra; candidate IDs/context summary to Sol | allowlisted diagnostics only |
| Preference profile | Dexie | bounded summary to Sol and structured live tool context | never log full profile or prompt |
| Weather coordinates/context | not persisted by the route | coordinates to Open-Meteo when requested; context to ranking | request ID/error only |
| Operational IDs/usage | Vercel logs | OpenAI/Upstash request chain | opaque IDs, stage, latency, status, token counts only |

`Reset app data` deletes all YiYi IndexedDB tables, including image blobs and
processing jobs, plus every `yiyi:` local/session-storage key. It preserves unrelated
origin storage. Demo wardrobe/profile records carry provenance and are removed on the
Personal transition. No analytics SDK or cross-app identifier is present.
