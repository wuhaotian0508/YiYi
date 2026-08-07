import { z } from "zod";
import { logApiDiagnostic, safeErrorMetadata } from "@/lib/api/diagnostics";
import { requestCrsResponseText } from "@/lib/api/crs-responses";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { providerRoutesAllowed, takeRateLimit } from "@/lib/api/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 20;

const VoiceInterpretRequestSchema = z.object({
  requestId: z.string().uuid(),
  transcript: z.string().trim().min(1).max(500),
}).strict();

const VoiceInterpretationSchema = z.object({
  activityPhrases: z.array(z.string().trim().min(1).max(60)).max(8),
  desiredFeelings: z.array(z.string().trim().min(1).max(50)).max(8),
  exclusions: z.array(z.string().trim().min(1).max(60)).max(8),
  wardrobeAnchors: z.array(z.string().trim().min(1).max(80)).max(4),
}).strict();

const instructions = "You extract a short outfit request into JSON for YiYi. Return exactly one JSON object with activityPhrases, desiredFeelings, exclusions, wardrobeAnchors; every field is an array of strings. Use concise English semantic phrases even if the user spoke another language. Do not invent clothing that the user did not mention. Put a requested owned item in wardrobeAnchors. Keep negations in exclusions. Use empty arrays when there is no evidence. No markdown and no explanation.";

function parseJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Language provider returned invalid JSON");
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

export async function POST(request: Request) {
  let requestId = crypto.randomUUID();
  const startedAt = Date.now();
  if (!providerRoutesAllowed()) return apiError(requestId, 503, "PUBLIC_PROTECTION_REQUIRED", "Live language understanding is not available until production rate protection is configured.", true);
  const rate = await takeRateLimit(request, "voice-interpret", 80);
  if (!rate.available) return apiError(requestId, 503, "RATE_LIMIT_UNAVAILABLE", "Live language understanding is temporarily unavailable.", true);
  if (!rate.allowed) return apiError(requestId, 429, "RATE_LIMITED", "Try again later.", true);
  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { return apiError(requestId, 400, "INVALID_JSON", "The request body was not valid JSON."); }
    const parsed = VoiceInterpretRequestSchema.safeParse(body);
    if (!parsed.success) return apiError(requestId, 400, "INVALID_VOICE_INTERPRET_REQUEST", "The voice transcript was invalid.");
    requestId = parsed.data.requestId;
    // Realtime and vision use OpenAI directly; CRS can use its own compatible key.
    const languageApiKey = process.env.CRS_API_KEY ?? process.env.OPENAI_API_KEY;
    if (process.env.AI_MODE !== "live" || !languageApiKey || !process.env.OPENAI_BASE_URL) {
      return apiError(requestId, 503, "NOT_CONFIGURED", "Live language understanding is not configured.", true);
    }
    const response = await requestCrsResponseText({
      baseUrl: process.env.OPENAI_BASE_URL,
      apiKey: languageApiKey,
      model: process.env.OPENAI_LANGUAGE_MODEL ?? process.env.OPENAI_RANK_MODEL ?? "gpt-5.5",
      instructions,
      text: parsed.data.transcript,
      signal: AbortSignal.timeout(15_000),
    });
    const interpretation = VoiceInterpretationSchema.safeParse(parseJsonObject(response.text));
    if (!interpretation.success) {
      logApiDiagnostic({ requestId, route: "/api/voice/interpret", provider: "openai-responses", model: response.model, outcome: "error", httpStatus: 200, durationMs: Date.now() - startedAt, errorCode: "INVALID_VOICE_INTERPRET_OUTPUT", errorType: "InvalidProviderOutput", usage: response.usage, providerStage: "voice-intent", schemaName: "VoiceInterpretation" });
      return apiError(requestId, 502, "INVALID_VOICE_INTERPRET_OUTPUT", "I could not understand that request clearly.", true);
    }
    const model = response.model ?? process.env.OPENAI_LANGUAGE_MODEL ?? process.env.OPENAI_RANK_MODEL ?? "gpt-5.5";
    logApiDiagnostic({ requestId, route: "/api/voice/interpret", provider: "openai-responses", model, outcome: "success", httpStatus: 200, durationMs: Date.now() - startedAt, usage: response.usage, providerStage: "voice-intent", schemaName: "VoiceInterpretation" });
    return noStoreJson({ requestId, source: "live", model, interpretation: interpretation.data });
  } catch (error) {
    const metadata = safeErrorMetadata(error);
    logApiDiagnostic({ requestId, route: "/api/voice/interpret", provider: "openai-responses", outcome: "error", ...metadata, durationMs: Date.now() - startedAt, errorCode: "VOICE_INTERPRET_PROVIDER_FAILED", providerStage: "voice-intent", schemaName: "VoiceInterpretation" });
    return apiError(requestId, 502, "VOICE_INTERPRET_PROVIDER_FAILED", "I could not understand that request right now.", true);
  }
}
