export type ApiDiagnostic = {
  requestId: string;
  route: "/api/realtime/token" | "/api/wardrobe/process" | "/api/outfits/rank";
  provider: "openai-realtime" | "openai-responses" | "photoroom" | "application";
  model?: string;
  outcome: "success" | "error";
  httpStatus?: number;
  durationMs: number;
  errorCode?: string;
  errorType?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

function statusCategory(status: number | undefined) {
  return status ? `${Math.floor(status / 100)}xx` : "unavailable";
}

export function safeErrorMetadata(error: unknown) {
  if (error instanceof Error) {
    const record = error as Error & { status?: unknown };
    return { errorType: error.name || "Error", httpStatus: typeof record.status === "number" ? record.status : undefined };
  }
  return { errorType: "UnknownError", httpStatus: undefined };
}

export function responseUsage(response: unknown): ApiDiagnostic["usage"] {
  if (!response || typeof response !== "object" || !("usage" in response)) return undefined;
  const usage = (response as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const values = usage as Record<string, unknown>;
  const inputTokens = typeof values.input_tokens === "number" ? values.input_tokens : undefined;
  const outputTokens = typeof values.output_tokens === "number" ? values.output_tokens : undefined;
  const totalTokens = typeof values.total_tokens === "number" ? values.total_tokens : undefined;
  return inputTokens === undefined && outputTokens === undefined && totalTokens === undefined ? undefined : { inputTokens, outputTokens, totalTokens };
}

export function logApiDiagnostic(diagnostic: ApiDiagnostic) {
  const payload = {
    event: "yiyi_api_provider",
    requestId: diagnostic.requestId,
    route: diagnostic.route,
    provider: diagnostic.provider,
    model: diagnostic.model,
    outcome: diagnostic.outcome,
    providerStatus: statusCategory(diagnostic.httpStatus),
    httpStatus: diagnostic.httpStatus,
    durationMs: Math.max(0, Math.round(diagnostic.durationMs)),
    errorCode: diagnostic.errorCode,
    errorType: diagnostic.errorType,
    usage: diagnostic.usage,
  };
  const serialized = JSON.stringify(payload);
  if (diagnostic.outcome === "error") console.error(serialized);
  else console.info(serialized);
}
