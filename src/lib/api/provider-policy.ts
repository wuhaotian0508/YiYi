export const providerTimeoutMs = {
  realtimeToken: 10_000,
  itemAnalysis: 20_000,
  // Listwise visual ranking returns one score entry per candidate, which measured
  // 13.5-18.5s against the CRS-hosted vision model. The ceiling stays below the
  // Realtime tool budget so a slow rank cannot outlive the turn that asked for it.
  outfitRanking: 26_000,
} as const;

/** Provider retries are user-scoped in YiYi; SDK-level retries can duplicate cost after aborts. */
export function openAIClientOptions(apiKey: string) {
  // CRS owns OPENAI_BASE_URL for its stream-only text route. Pin SDK-backed
  // Realtime and transcription calls to OpenAI's endpoint. Ranking chooses its
  // own endpoint per request, because vision may be hosted on either provider.
  return { apiKey, baseURL: "https://api.openai.com/v1", maxRetries: 0 } as const;
}
