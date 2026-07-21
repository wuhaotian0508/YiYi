import { z } from "zod";

const SafeTextSchema = z.string().max(180).regex(/^[^\u0000-\u001f\u007f]*$/);
const BlobSummarySchema = z.object({ mime: z.string().max(80), bytes: z.number().int().nonnegative().max(25_000_000) }).strict();

export const WardrobeLocalSaveDiagnosticSchema = z.object({
  requestId: z.string().uuid(),
  stage: z.string().min(1).max(48).regex(/^[a-z0-9-]+$/),
  errorCode: z.string().min(1).max(80).regex(/^[A-Z0-9_]+$/),
  errorName: SafeTextSchema,
  errorMessage: SafeTextSchema,
  innerErrorName: SafeTextSchema.nullable(),
  innerErrorMessage: SafeTextSchema.nullable(),
  completedStages: z.array(z.string().min(1).max(48).regex(/^[a-z0-9-]+$/)).max(16),
  blobs: z.object({ original: BlobSummarySchema.nullable(), cutout: BlobSummarySchema.nullable(), thumbnail: BlobSummarySchema.nullable() }).strict(),
  storage: z.object({ usage: z.number().nonnegative().nullable(), quota: z.number().nonnegative().nullable() }).strict(),
  databaseVersion: z.number().nonnegative(),
}).strict();

function boundedErrorText(value: unknown) {
  return typeof value === "string" ? value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[redacted-image]")
    .replace(/\b(?:sk|ek)_[a-z0-9_-]+\b/gi, "[redacted-token]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 180) : "";
}

function errorRecord(error: unknown) {
  return error && typeof error === "object" ? error as Record<string, unknown> : null;
}

function blobSummary(blob: Blob | null) {
  return blob ? { mime: blob.type.slice(0, 80), bytes: blob.size } : null;
}

export async function createWardrobeLocalSaveDiagnostic(input: {
  requestId: string;
  stage: string;
  errorCode: string;
  error: unknown;
  completedStages: string[];
  originalBlob: Blob | null;
  cutoutBlob: Blob | null;
  thumbnailBlob: Blob | null;
  databaseVersion: number;
}) {
  const error = errorRecord(input.error);
  const inner = errorRecord(error?.inner ?? error?.innerException);
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    usage = typeof estimate?.usage === "number" ? estimate.usage : null;
    quota = typeof estimate?.quota === "number" ? estimate.quota : null;
  } catch { /* Diagnostics must never replace the product error. */ }
  return WardrobeLocalSaveDiagnosticSchema.parse({
    requestId: input.requestId,
    stage: input.stage,
    errorCode: input.errorCode,
    errorName: boundedErrorText(error?.name ?? (input.error instanceof Error ? input.error.name : typeof input.error)),
    errorMessage: boundedErrorText(error?.message ?? (input.error instanceof Error ? input.error.message : "Unknown local save error")),
    innerErrorName: inner ? boundedErrorText(inner.name) : null,
    innerErrorMessage: inner ? boundedErrorText(inner.message) : null,
    completedStages: [...new Set(input.completedStages)].slice(0, 16),
    blobs: {
      original: blobSummary(input.originalBlob),
      cutout: blobSummary(input.cutoutBlob),
      thumbnail: blobSummary(input.thumbnailBlob),
    },
    storage: { usage, quota },
    databaseVersion: input.databaseVersion,
  });
}

export async function reportWardrobeLocalSaveFailure(diagnostic: z.infer<typeof WardrobeLocalSaveDiagnosticSchema>) {
  try {
    await fetch("/api/diagnostics/wardrobe-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(diagnostic),
      cache: "no-store",
      keepalive: true,
    });
  } catch { /* The local error remains visible with its diagnostic ID. */ }
}
