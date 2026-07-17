# YiYi API Contracts

Every route validates request and response with Zod, returns a request ID, uses the common error envelope, runs on the intended Vercel runtime, avoids provider-body leakage, and never logs secrets or image/audio content.

## Common error

```ts
type ApiError = {
  requestId: string;
  error: { code: string; message: string; retryable: boolean };
};
```

## Routes

- `POST /api/realtime/token`: same-origin, no-cache ephemeral client secret `{ requestId, value, model, voice }`; model and voice keep the SDK session aligned with the minted secret.
- `POST /api/wardrobe/process`: one validated multipart image; returns `{ requestId, cutoutDataUrl, analysis }`. The client converts the string to a Blob immediately.
- `POST /api/outfits/rank`: original utterance, intent, preference summary, optional weather, and maximum eight supplied candidates with compact boards; returns three validated supplied IDs and short reasons.
- `GET /api/weather`: validated coordinates/city to normalized next-12-hour weather; 15-minute cache.
- `GET /api/health`: configuration presence, mock/live mode, and app version only—never secret values.

## External providers

- OpenAI Responses: item model `gpt-5.6-terra`, rank model `gpt-5.6`, Structured Outputs, `store: false`.
- OpenAI Realtime: `gpt-realtime-2.1-mini` in development and `gpt-realtime-2.1` for production demo through an ephemeral client secret.
- Photoroom: `/v1/segment`, transparent WebP, `size=medium`, `crop=true`.
- Open-Meteo: next 12 hours, normalized before reaching product code.
