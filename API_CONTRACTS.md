# YiYi API Contracts

Every route validates request and response with Zod, returns a request ID, uses the common error envelope, runs on the intended Vercel runtime, avoids provider-body leakage, and never logs secrets or image/audio content.

Live provider calls emit one-line structured diagnostics containing only application/provider request IDs, route, provider/model, HTTP status category when available, duration, allowlisted error code/type, candidate/board counts, and aggregate token usage when available. They never include credentials, ephemeral secrets, images/Data URLs, prompts, transcripts, error messages, or provider response bodies.

## Common error

```ts
type ApiError = {
  requestId: string;
  error: { code: string; message: string; retryable: boolean };
};
```

## Routes

- `POST /api/realtime/token`: same-origin, no-cache ephemeral client secret `{ requestId, value, model, voice }`; a supplied browser `Origin` must safely parse and exactly match the effective host (including a non-default port). Origin-less same-site/server requests remain allowed by the current deployment policy. Optional correlation headers `X-YiYi-Voice-Attempt` (UUID) and `X-YiYi-Voice-Generation` (integer) are validated and may appear only in safe lifecycle diagnostics. A 429 uses the common error envelope plus an integer-seconds `Retry-After` header; the client does not automatically retry.
- `POST /api/wardrobe/process`: one validated multipart image; malformed multipart is a 4xx boundary error. Input MIME is derived from magic bytes. Photoroom output must be a bounded, single-frame WebP with validated bytes, dimensions and pixels before it is normalized to a bounded 1024px WebP and sent to Terra. Returns `{ requestId, cutoutDataUrl, analysis }`; the client converts the string to a Blob immediately.
- `POST /api/outfits/rank`: non-empty original utterance (the client substitutes a structured summary when needed), intent, preference summary, optional weather, and maximum eight supplied candidates with individually bounded compact WebP boards or a PNG canvas fallback when WebKit cannot encode WebP. Every decoded board's format, single-frame metadata, true dimensions and pixel count must match its declaration before provider use. Malformed JSON and invalid schemas are distinct 400 errors. Selected and scored IDs must exactly cover the request candidate set. Client domain code applies the 70% deterministic / 30% visual merge and chooses the final supplied ID. Mock/live/fallback source and actual model are returned separately with safe board/candidate diagnostics. Failure falls back to one deterministic legal candidate.
- A staged Sol compatibility probe is available only when a local process explicitly sets `YIYI_RANK_COMPATIBILITY=true`; it is disabled in production and returns only model, timing, usage, MIME/dimensions/bytes, stage, and schema name. It never returns or logs images, prompts, or provider bodies.
- `GET /api/weather`: without coordinates, returns the fixed competition-demo weather; with both validated latitude and longitude, returns the next 12 hours of normalized Open-Meteo weather. A half coordinate pair is `400 INVALID_LOCATION`. Today explicitly uses `NEXT_PUBLIC_WEATHER_MODE=fixed-demo`, checks the returned source, and does not request location permission.
- `GET /api/health`: configuration presence, mock/live modes, configured model and voice names, scoring version, rate-limit mode, actual distributed production-protection readiness, current-environment provider-route allowance, and app version—never secret values. `providerRoutesAllowed` may be true in local/mock mode while `productionProtectionReady` remains false until Upstash is configured.

In production live mode, provider-backed routes require both Upstash REST credentials. The local per-instance map is not treated as public cost protection, and a platform-protection environment assertion is not accepted as proof.

## External providers

- OpenAI Responses: item model `gpt-5.6-terra`, rank model `gpt-5.6`, Structured Outputs, `store: false`.
- OpenAI Realtime: `gpt-realtime-2.1-mini` in development and `gpt-realtime-2.1` for production demo through an ephemeral client secret.
- Photoroom: `/v1/segment`, transparent WebP, `size=medium`, `crop=true`.
- Open-Meteo: next 12 hours, normalized before reaching product code.
