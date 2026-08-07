export const providerTimeoutMs = {
  realtimeToken: 10_000,
  itemAnalysis: 20_000,
  outfitRanking: 20_000,
} as const;

/** Provider retries are user-scoped in YiYi; SDK-level retries can duplicate cost after aborts. */
export function openAIClientOptions(apiKey: string) {
  // CRS owns OPENAI_BASE_URL for its stream-only text route. Pin SDK-backed
  // Realtime, transcription, vision, and ranking calls to OpenAI's endpoint.
  return { apiKey, baseURL: "https://api.openai.com/v1", maxRetries: 0 } as const;
}
