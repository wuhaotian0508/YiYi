import { noStoreJson } from "@/lib/api/responses";
import { productionProtectionReady, providerRoutesAllowed, rateLimitMode } from "@/lib/api/rate-limit";
import { SCORING_VERSION } from "@/domain/recommendation/scoring";
import { DEFAULT_REALTIME_MODEL, DEFAULT_REALTIME_TRANSCRIPTION_MODEL, DEFAULT_REALTIME_VOICE } from "@/lib/realtime/config";
import { shopifyConfigured } from "@/lib/shopify/admin";

export const runtime = "nodejs";

export function GET() {
  return noStoreJson({
    requestId: crypto.randomUUID(),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    languageConfigured: Boolean(process.env.CRS_API_KEY ?? process.env.OPENAI_API_KEY),
    languageBaseConfigured: Boolean(process.env.OPENAI_LANGUAGE_BASE_URL ?? process.env.OPENAI_BASE_URL),
    photoroomConfigured: Boolean(process.env.PHOTOROOM_API_KEY),
    shopifyConfigured: shopifyConfigured(),
    aiMode: process.env.AI_MODE === "live" ? "live" : "mock",
    voiceMode: process.env.NEXT_PUBLIC_VOICE_MODE === "browser" ? "browser" : process.env.NEXT_PUBLIC_VOICE_MODE === "live" ? "live" : "mock",
    itemModel: process.env.OPENAI_ITEM_MODEL ?? "gpt-5.6-terra",
    rankModel: process.env.OPENAI_RANK_MODEL ?? "gpt-5.6",
    languageModel: process.env.OPENAI_LANGUAGE_MODEL ?? process.env.OPENAI_RANK_MODEL ?? "gpt-5.5",
    realtimeModel: process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL,
    realtimeTranscriptionModel: process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
    realtimeVoice: process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE,
    scoringVersion: SCORING_VERSION,
    rateLimitMode: rateLimitMode(),
    productionProtectionReady: productionProtectionReady(),
    providerRoutesAllowed: providerRoutesAllowed(),
    version: process.env.npm_package_version ?? "0.1.0",
  });
}
