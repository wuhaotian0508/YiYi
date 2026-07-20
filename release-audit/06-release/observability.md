# Observability contract

No monitoring SDK was added. Existing Vercel logs use two allowlisted JSON events:

- `yiyi_voice_lifecycle`: voiceAttemptId, sessionGeneration, owner, stage, result,
  duration, retry count, SDK status and disconnect reason.
- `yiyi_api_provider`: requestId, route/provider/model, live outcome, status, stage,
  latency, usage, candidate/image dimensions, provider request ID and safe error code.

Recommendation ranking now additionally carries `recommendationOperationId`,
`profileVersion` and `outfitVersion` from Today through the ranking boundary to the
provider log. OpenAI token/image/audio/prompt/transcript and preference contents are
not log fields. The client-generated request UUID is validated and reused by the
ranking route, so one operation can be joined without a persistent user identifier.
