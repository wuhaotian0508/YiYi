import OpenAI from "openai";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { providerRoutesAllowed, takeRateLimit } from "@/lib/api/rate-limit";
import { logApiDiagnostic, safeErrorMetadata } from "@/lib/api/diagnostics";
import { openAIClientOptions, providerTimeoutMs } from "@/lib/api/provider-policy";

export const runtime = "nodejs";

function requestOriginIsAllowed(origin: string | null, host: string | null) {
  // Non-browser and same-origin server requests may omit Origin. Browser requests
  // that provide it must match the effective host exactly, including the port.
  if (!origin) return true;
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin === origin && parsed.host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const routeStartedAt = Date.now();
  const requestId = crypto.randomUUID();
  const attemptHeader = request.headers.get("x-yiyi-voice-attempt");
  const generationHeader = request.headers.get("x-yiyi-voice-generation");
  const voiceAttemptId = attemptHeader && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptHeader) ? attemptHeader : undefined;
  const sessionGeneration = generationHeader && /^\d{1,9}$/.test(generationHeader) ? Number(generationHeader) : undefined;
  const fail = (status: number, code: string, message: string, retryable = false, retryAfterSeconds?: number) => {
    logApiDiagnostic({ requestId, route: "/api/realtime/token", provider: "application", outcome: "error", httpStatus: status, durationMs: Date.now() - routeStartedAt, errorCode: code, errorType: "VoiceTokenRouteError", voiceAttemptId, sessionGeneration, voiceStage: "token", retryCount: 0, tokenRequest: "new" });
    return apiError(requestId, status, code, message, retryable, retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined);
  };
  if (!providerRoutesAllowed()) return fail(503, "PUBLIC_PROTECTION_REQUIRED", "Live voice is not available until production rate protection is configured.", true);
  const rate = await takeRateLimit(request, "realtime-token", 10);
  if (!rate.available) return fail(503, "RATE_LIMIT_UNAVAILABLE", "Live voice protection is temporarily unavailable.", true);
  if (!rate.allowed) return fail(429, "RATE_LIMITED", `Try again in ${rate.retryAfterSeconds} seconds.`, true, rate.retryAfterSeconds);
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = request.headers.get("host") || forwardedHost || null;
  if (!requestOriginIsAllowed(origin, host)) return fail(403, "INVALID_ORIGIN", "Request origin is not allowed.");
  if (process.env.NEXT_PUBLIC_VOICE_MODE !== "live") return fail(409, "MOCK_MODE", "Live voice is disabled in this environment.");
  if (!process.env.OPENAI_API_KEY) return fail(503, "NOT_CONFIGURED", "Live voice is not configured.", true);
  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1-mini";
  const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";
  const providerStartedAt = Date.now();
  try {
    const client = new OpenAI(openAIClientOptions(process.env.OPENAI_API_KEY));
    const secret = await client.realtime.clientSecrets.create({
      expires_after: { anchor: "created_at", seconds: 120 },
      session: {
        type: "realtime",
        model,
        output_modalities: ["audio"],
        audio: {
          input: { noise_reduction: { type: "near_field" }, turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: false } },
          output: { voice },
        },
        max_output_tokens: 220,
        tracing: null,
      },
    }, { signal: AbortSignal.timeout(providerTimeoutMs.realtimeToken) });
    logApiDiagnostic({ requestId, route: "/api/realtime/token", provider: "openai-realtime", model, outcome: "success", httpStatus: 200, durationMs: Date.now() - providerStartedAt, voiceAttemptId, sessionGeneration, voiceStage: "token", retryCount: 0, tokenRequest: "new" });
    return noStoreJson({ requestId, value: secret.value, expiresAt: secret.expires_at, model, voice });
  } catch (error) {
    const metadata = safeErrorMetadata(error);
    logApiDiagnostic({ requestId, route: "/api/realtime/token", provider: "openai-realtime", model, outcome: "error", ...metadata, durationMs: Date.now() - providerStartedAt, errorCode: "TOKEN_PROVIDER_FAILED", voiceAttemptId, sessionGeneration, voiceStage: "token", retryCount: 0, tokenRequest: "new" });
    return apiError(requestId, 502, "TOKEN_PROVIDER_FAILED", "Could not start live voice right now.", true);
  }
}
