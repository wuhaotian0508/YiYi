import { z } from "zod";

export const WardrobeProcessErrorResponseSchema = z.object({
  requestId: z.string().uuid(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }),
}).passthrough();

const transientCodes = new Set(["BACKGROUND_REMOVAL_FAILED"]);

export function shouldRetryWardrobeProcessing(status: number, code: string, retryable: boolean) {
  return retryable && status === 502 && transientCodes.has(code);
}

export class WardrobeProcessingError extends Error {
  constructor(
    message: string,
    readonly requestId: string | null,
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "WardrobeProcessingError";
  }
}
