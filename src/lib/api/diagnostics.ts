export type ApiDiagnostic = {
  requestId: string;
  route: "/api/realtime/token" | "/api/wardrobe/process" | "/api/outfits/rank" | "/api/weather" | "/api/voice/interpret";
  provider: "openai-realtime" | "openai-responses" | "photoroom" | "open-meteo" | "application";
  model?: string;
  outcome: "success" | "error";
  httpStatus?: number;
  durationMs: number;
  errorCode?: string;
  errorType?: string;
  providerErrorCode?: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  candidateCount?: number;
  boardBytes?: number;
  boardWidth?: number;
  boardHeight?: number;
  imageMime?: "image/webp" | "image/png" | "mixed";
  providerStage?: string;
  schemaName?: string;
  voiceAttemptId?: string;
  sessionGeneration?: number;
  voiceStage?: string;
  retryCount?: number;
  tokenRequest?: "new" | "reused";
  recommendationOperationId?: string;
  profileVersion?: number;
  outfitVersion?: string | null;
};

function statusCategory(status: number | undefined) {
  return status ? `${Math.floor(status / 100)}xx` : "unavailable";
}

export function safeErrorMetadata(error: unknown) {
  if (error instanceof Error) {
    const record = error as Error & { status?: unknown; code?: unknown; type?: unknown; request_id?: unknown; requestId?: unknown };
    const safeIdentifier = (value: unknown, max = 100) => typeof value === "string" && value.length <= max && /^[a-zA-Z0-9_.:-]+$/.test(value) ? value : undefined;
    return {
      errorType: safeIdentifier(record.type) ?? safeIdentifier(error.name) ?? "Error",
      httpStatus: typeof record.status === "number" ? record.status : undefined,
      providerErrorCode: safeIdentifier(record.code),
      providerRequestId: safeIdentifier(record.request_id ?? record.requestId),
    };
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

export function responseRequestId(response: unknown) {
  if (!response || typeof response !== "object") return undefined;
  const value = (response as { _request_id?: unknown; request_id?: unknown })._request_id ?? (response as { request_id?: unknown }).request_id;
  return typeof value === "string" && value.length <= 100 && /^[a-zA-Z0-9_.:-]+$/.test(value) ? value : undefined;
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
    providerErrorCode: diagnostic.providerErrorCode,
    providerRequestId: diagnostic.providerRequestId,
    usage: diagnostic.usage,
    candidateCount: diagnostic.candidateCount,
    boardBytes: diagnostic.boardBytes,
    boardWidth: diagnostic.boardWidth,
    boardHeight: diagnostic.boardHeight,
    imageMime: diagnostic.imageMime,
    providerStage: diagnostic.providerStage,
    schemaName: diagnostic.schemaName,
    voiceAttemptId: diagnostic.voiceAttemptId,
    sessionGeneration: diagnostic.sessionGeneration,
    voiceStage: diagnostic.voiceStage,
    retryCount: diagnostic.retryCount,
    tokenRequest: diagnostic.tokenRequest,
    recommendationOperationId: diagnostic.recommendationOperationId,
    profileVersion: diagnostic.profileVersion,
    outfitVersion: diagnostic.outfitVersion,
  };
  const serialized = JSON.stringify(payload);
  if (diagnostic.outcome === "error") console.error(serialized);
  else console.info(serialized);
}
