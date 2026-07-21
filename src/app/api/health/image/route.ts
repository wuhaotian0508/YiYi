import { noStoreJson } from "@/lib/api/responses";
import { sharpRuntimeSmoke } from "@/lib/images/sharp-runtime";

export const runtime = "nodejs";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const result = await sharpRuntimeSmoke();
    return noStoreJson({ requestId, ready: true, runtime: result });
  } catch {
    return noStoreJson({ requestId, ready: false, error: { code: "IMAGE_RUNTIME_UNAVAILABLE", retryable: false } }, 503);
  }
}
