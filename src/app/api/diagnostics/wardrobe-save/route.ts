import { WardrobeLocalSaveDiagnosticSchema } from "@/lib/wardrobe/local-save-diagnostics";
import { apiError, noStoreJson } from "@/lib/api/responses";

export const runtime = "nodejs";

function sameOrigin(origin: string | null, host: string | null) {
  if (!origin) return true;
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.origin === origin && parsed.host === host;
  } catch { return false; }
}

export async function POST(request: Request) {
  const fallbackId = crypto.randomUUID();
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return apiError(fallbackId, 403, "INVALID_ORIGIN", "Request origin is not allowed.");
  }
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return apiError(fallbackId, 415, "UNSUPPORTED_MEDIA_TYPE", "Send JSON diagnostics.");
  }
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return apiError(fallbackId, 400, "INVALID_JSON", "The diagnostic was not valid JSON."); }
  const parsed = WardrobeLocalSaveDiagnosticSchema.safeParse(payload);
  if (!parsed.success) return apiError(fallbackId, 400, "INVALID_DIAGNOSTIC", "The diagnostic was invalid.");
  console.error(JSON.stringify({ event: "yiyi_wardrobe_local_save", outcome: "error", ...parsed.data }));
  return noStoreJson({ requestId: parsed.data.requestId, accepted: true }, 202);
}
