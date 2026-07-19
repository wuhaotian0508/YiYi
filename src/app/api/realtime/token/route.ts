import OpenAI from "openai";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { providerRoutesAllowed, takeRateLimit } from "@/lib/api/rate-limit";
import { logApiDiagnostic, safeErrorMetadata } from "@/lib/api/diagnostics";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  if (!providerRoutesAllowed()) return apiError(requestId, 503, "PUBLIC_PROTECTION_REQUIRED", "Live voice is not available until production rate protection is configured.", true);
  const rate = await takeRateLimit(request, "realtime-token", 10);
  if (!rate.allowed) return apiError(requestId, 429, "RATE_LIMITED", `Try again in ${rate.retryAfterSeconds} seconds.`, true);
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return apiError(requestId, 403, "INVALID_ORIGIN", "Request origin is not allowed.");
  if (process.env.NEXT_PUBLIC_VOICE_MODE !== "live") return apiError(requestId, 409, "MOCK_MODE", "Live voice is disabled in this environment.");
  if (!process.env.OPENAI_API_KEY) return apiError(requestId, 503, "NOT_CONFIGURED", "Live voice is not configured.", true);
  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1-mini";
  const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";
  const providerStartedAt = Date.now();
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const secret = await client.realtime.clientSecrets.create({
      expires_after: { anchor: "created_at", seconds: 120 },
      session: {
        type: "realtime",
        model,
        output_modalities: ["audio"],
        audio: {
          input: { noise_reduction: { type: "near_field" }, turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true } },
          output: { voice },
        },
        max_output_tokens: 220,
        tracing: null,
      },
    });
    logApiDiagnostic({ requestId, route: "/api/realtime/token", provider: "openai-realtime", model, outcome: "success", httpStatus: 200, durationMs: Date.now() - providerStartedAt });
    return noStoreJson({ requestId, value: secret.value, expiresAt: secret.expires_at, model, voice });
  } catch (error) {
    const metadata = safeErrorMetadata(error);
    logApiDiagnostic({ requestId, route: "/api/realtime/token", provider: "openai-realtime", model, outcome: "error", ...metadata, durationMs: Date.now() - providerStartedAt, errorCode: "TOKEN_PROVIDER_FAILED" });
    return apiError(requestId, 502, "TOKEN_PROVIDER_FAILED", "Could not start live voice right now.", true);
  }
}
