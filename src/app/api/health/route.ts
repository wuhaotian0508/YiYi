import { noStoreJson } from "@/lib/api/responses";

export const runtime = "nodejs";

export function GET() {
  return noStoreJson({
    requestId: crypto.randomUUID(),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    photoroomConfigured: Boolean(process.env.PHOTOROOM_API_KEY),
    aiMode: process.env.AI_MODE === "live" ? "live" : "mock",
    version: process.env.npm_package_version ?? "0.1.0",
  });
}
