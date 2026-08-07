import { noStoreJson } from "@/lib/api/responses";
import { productionProtectionReady, providerRoutesAllowed, rateLimitMode } from "@/lib/api/rate-limit";
import { SCORING_VERSION } from "@/domain/recommendation/scoring";

export const runtime = "nodejs";

export function GET() {
  return noStoreJson({
    requestId: crypto.randomUUID(),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    languageConfigured: Boolean(process.env.CRS_API_KEY ?? process.env.OPENAI_API_KEY),
    languageBaseConfigured: Boolean(process.env.OPENAI_BASE_URL),
    photoroomConfigured: Boolean(process.env.PHOTOROOM_API_KEY),
    aiMode: process.env.AI_MODE === "live" ? "live" : "mock",
    voiceMode: process.env.NEXT_PUBLIC_VOICE_MODE === "browser" ? "browser" : process.env.NEXT_PUBLIC_VOICE_MODE === "live" ? "live" : "mock",
    itemModel: process.env.OPENAI_ITEM_MODEL ?? "gpt-5.6-terra",
    rankModel: process.env.OPENAI_RANK_MODEL ?? "gpt-5.6",
    languageModel: process.env.OPENAI_LANGUAGE_MODEL ?? process.env.OPENAI_RANK_MODEL ?? "gpt-5.5",
    realtimeModel: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1-mini",
    realtimeVoice: process.env.OPENAI_REALTIME_VOICE ?? "marin",
    scoringVersion: SCORING_VERSION,
    rateLimitMode: rateLimitMode(),
    productionProtectionReady: productionProtectionReady(),
    providerRoutesAllowed: providerRoutesAllowed(),
    version: process.env.npm_package_version ?? "0.1.0",
  });
}
