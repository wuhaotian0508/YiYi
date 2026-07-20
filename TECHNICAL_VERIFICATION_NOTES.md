# Technical Verification Notes

The master document incorporates these important corrections from earlier planning:

1. **Realtime:** use the official OpenAI Agents SDK (`RealtimeAgent` and `RealtimeSession`) with a server-minted ephemeral token from `/v1/realtime/client_secrets`. Do not hand-write raw WebRTC/SDP.
2. **Voice tools:** Realtime tools remain strict and every execution is parsed by the canonical Zod v4 schema. With installed `@openai/agents` 0.13.4, schemas containing Zod input transforms are converted through `z.toJSONSchema(schema, { io: "input" })` before SDK tool construction; passing the transform-bearing Zod object directly fails before WebRTC connect.
3. **Models:** use `gpt-realtime-2.1` for the final voice demo, `gpt-realtime-2.1-mini` for development, `gpt-5.6-terra` for item analysis, and `gpt-5.6`/Sol for candidate ranking.
4. **Camera:** use the native iPhone camera/photo picker for the competition, not a custom live camera.
5. **Background removal:** use Photoroom Basic `/v1/segment`, output transparent WebP, `size=medium`, `crop=true`, then normalize into a standard canvas.
6. **Vercel payload:** both request and response must remain below 4.5MB. Preprocess on-device, process one item per request, and keep candidate boards compact.
7. **Ranking:** generate candidates deterministically on the client, render at most eight compact outfit boards, and let Sol rank only supplied candidate IDs.
8. **Storage:** separate metadata and image Blob tables in Dexie; request persistent storage and never persist Data URLs.
9. **PWA:** direct Safari use is supported; Home Screen installation is optional. Storage context may differ between Safari and the installed web app, so judges should use one context consistently.
10. **Scope:** no cloud database, account, calendar, native app, virtual try-on, or custom camera before submission.
11. **Voice ownership:** one app-level coordinator serializes token, connect, active adapter, and teardown across Today and Fine-tune. Page phases never initiate a connection, 429 obeys `Retry-After`, and there is no automatic reconnect loop.
