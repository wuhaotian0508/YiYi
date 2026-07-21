import type { VoiceFailureStage } from "@/lib/realtime/voice-session";

export type VoiceDiagnostic = {
  voiceAttemptId: string;
  sessionGeneration: number;
  owner: "today" | "fine-tune";
  stage: VoiceFailureStage;
  result: "started" | "success" | "error" | "cancelled" | "reused";
  durationMs: number;
  retryCount: number;
  httpStatus?: number;
  errorCode?: string;
  errorType?: string;
  sdkConnectionStatus?: string;
  disconnectReason?: string;
  tokenRequest?: "new" | "reused";
  speechStoppedAt?: number;
  toolName?: string;
  toolStartAt?: number;
  toolEndAt?: number;
  success?: boolean;
  zodIssuePaths?: string[];
  outfitCommittedAt?: number;
  audioStartedAt?: number;
  turnCommittedAt?: number;
  outfitVersionId?: string;
  realtimeEvent?: string;
  responseId?: string;
  responseStatus?: string;
  outputItemType?: string;
  argumentBytes?: number;
  effectiveToolChoice?: string;
  effectiveToolNames?: string[];
  requestId?: string;
  effectiveVadType?: string;
  effectiveTranscriptionModel?: string;
  effectiveCreateResponse?: boolean;
  effectiveInterruptResponse?: boolean;
};

export function logVoiceDiagnostic(diagnostic: VoiceDiagnostic) {
  const payload = JSON.stringify({
    event: "yiyi_voice_lifecycle",
    ...diagnostic,
    durationMs: Math.max(0, Math.round(diagnostic.durationMs)),
  });
  if (diagnostic.result === "error") console.error(payload);
  else console.info(payload);
}
