export const providerTimeoutMs = {
  realtimeToken: 10_000,
  itemAnalysis: 20_000,
  outfitRanking: 20_000,
} as const;

/** Provider retries are user-scoped in YiYi; SDK-level retries can duplicate cost after aborts. */
export function openAIClientOptions(apiKey: string) {
  return { apiKey, maxRetries: 0 } as const;
}
