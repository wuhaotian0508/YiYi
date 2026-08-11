import { apiError } from "@/lib/api/responses";
import { takeRateLimit } from "@/lib/api/rate-limit";
import { verifiedCloudUser } from "@/lib/cloud/server-auth";
import { isImageRuntimeUnavailable, loadSharp } from "@/lib/images/sharp-runtime";
import {
  resolveProductMedia,
  ShopifyAdminError,
  shopifyConfigured,
} from "@/lib/shopify/admin";
import { ShopifyMediaRequestSchema } from "@/lib/shopify/schemas";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_SIDE = 12_000;
const MAX_IMAGE_PIXELS = 60_000_000;
const IMAGE_TIMEOUT_MS = 20_000;

type DetectedImage = {
  format: "jpeg" | "png" | "webp" | "heif";
  mime: "image/jpeg" | "image/png" | "image/webp" | "image/heic";
};

function detectImage(bytes: Uint8Array): DetectedImage | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: "jpeg", mime: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { format: "png", mime: "image/png" };
  }
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    return { format: "webp", mime: "image/webp" };
  }
  if (bytes.length >= 12 && ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return { format: "heif", mime: "image/heic" };
    }
  }
  return null;
}

function safeCdnUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "cdn.shopify.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function readBounded(response: Response): Promise<Uint8Array | null> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_IMAGE_BYTES) return null;
  }

  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function authError(requestId: string, code: "UNAUTHORIZED" | "CLOUD_NOT_CONFIGURED") {
  return code === "UNAUTHORIZED"
    ? apiError(requestId, 401, code, "Sign in to import your Shopify purchases.")
    : apiError(requestId, 503, code, "Account sign-in is not configured.", true);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const user = await verifiedCloudUser(request);
  if (!user.ok) return authError(requestId, user.code);

  if (!shopifyConfigured()) {
    return apiError(
      requestId,
      503,
      "SHOPIFY_NOT_CONFIGURED",
      "Shopify purchase import is not configured.",
      true,
    );
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return apiError(requestId, 415, "UNSUPPORTED_MEDIA_TYPE", "Send a JSON image request.");
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(requestId, 400, "INVALID_JSON", "The image request was invalid.");
  }
  const body = ShopifyMediaRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return apiError(
      requestId,
      400,
      "INVALID_IMAGE_REQUEST",
      "The Shopify image selection was invalid.",
    );
  }

  const rate = await takeRateLimit(request, "shopify-image", 24);
  if (!rate.available) {
    return apiError(
      requestId,
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "Shopify image import is temporarily unavailable.",
      true,
    );
  }
  if (!rate.allowed) {
    return apiError(
      requestId,
      429,
      "RATE_LIMITED",
      "Too many Shopify images were requested. Try again shortly.",
      true,
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  try {
    const media = await resolveProductMedia(body.data);
    if (
      media.width > MAX_IMAGE_SIDE ||
      media.height > MAX_IMAGE_SIDE ||
      media.width * media.height > MAX_IMAGE_PIXELS
    ) {
      return apiError(
        requestId,
        415,
        "INVALID_SHOPIFY_IMAGE",
        "This Shopify image cannot be imported.",
      );
    }

    const url = safeCdnUrl(media.url);
    if (!url) {
      return apiError(
        requestId,
        502,
        "UNSAFE_SHOPIFY_IMAGE",
        "The Shopify image source was not accepted.",
      );
    }

    let providerResponse: Response;
    try {
      providerResponse = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });
    } catch {
      return apiError(
        requestId,
        502,
        "SHOPIFY_IMAGE_UNAVAILABLE",
        "The Shopify image could not be downloaded.",
        true,
      );
    }
    if (!providerResponse.ok || providerResponse.status >= 300) {
      return apiError(
        requestId,
        502,
        "SHOPIFY_IMAGE_UNAVAILABLE",
        "The Shopify image could not be downloaded.",
        providerResponse.status === 429 || providerResponse.status >= 500,
      );
    }

    const declaredMime = providerResponse.headers.get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const allowedDeclaredMimes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]);
    if (!declaredMime || !allowedDeclaredMimes.has(declaredMime)) {
      return apiError(
        requestId,
        415,
        "UNSUPPORTED_SHOPIFY_IMAGE",
        "Use a JPEG, PNG, WebP, or HEIC Shopify image.",
      );
    }

    const declaredLength = providerResponse.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > MAX_IMAGE_BYTES) {
      return apiError(
        requestId,
        413,
        "SHOPIFY_IMAGE_TOO_LARGE",
        "This Shopify image is too large to import.",
      );
    }
    const bytes = await readBounded(providerResponse);
    if (!bytes) {
      return apiError(
        requestId,
        413,
        "SHOPIFY_IMAGE_TOO_LARGE",
        "This Shopify image is too large to import.",
      );
    }

    const detected = detectImage(bytes.subarray(0, 32));
    const declaredMatches =
      detected &&
      (declaredMime === detected.mime ||
        (detected.format === "heif" && declaredMime === "image/heif"));
    if (!detected || !declaredMatches) {
      return apiError(
        requestId,
        415,
        "UNSUPPORTED_SHOPIFY_IMAGE",
        "Use a JPEG, PNG, WebP, or HEIC Shopify image.",
      );
    }

    const sharp = await loadSharp();
    let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try {
      metadata = await sharp(bytes, {
        limitInputPixels: MAX_IMAGE_PIXELS,
        failOn: "warning",
      }).metadata();
    } catch (error) {
      if (isImageRuntimeUnavailable(error)) throw error;
      return apiError(
        requestId,
        415,
        "INVALID_SHOPIFY_IMAGE",
        "This Shopify image cannot be imported.",
      );
    }
    if (
      metadata.format !== detected.format ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_IMAGE_SIDE ||
      metadata.height > MAX_IMAGE_SIDE ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
      (metadata.pages ?? 1) !== 1
    ) {
      return apiError(
        requestId,
        415,
        "INVALID_SHOPIFY_IMAGE",
        "This Shopify image cannot be imported.",
      );
    }

    const output = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(output, {
      status: 200,
      headers: {
        "Content-Type": detected.mime,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ShopifyAdminError) {
      const notConfigured = error.code === "NOT_CONFIGURED";
      const notFound = error.code === "SHOPIFY_MEDIA_NOT_FOUND";
      return apiError(
        requestId,
        notConfigured ? 503 : notFound ? 404 : 502,
        notConfigured
          ? "SHOPIFY_NOT_CONFIGURED"
          : notFound
            ? "SHOPIFY_IMAGE_NOT_FOUND"
            : "SHOPIFY_IMAGE_UNAVAILABLE",
        notConfigured
          ? "Shopify purchase import is not configured."
          : notFound
            ? "That Shopify image is no longer available."
            : "The Shopify image could not be downloaded.",
        error.retryable,
      );
    }
    if (isImageRuntimeUnavailable(error)) {
      return apiError(
        requestId,
        503,
        "IMAGE_RUNTIME_UNAVAILABLE",
        "Shopify image import is temporarily unavailable.",
        true,
      );
    }
    return apiError(
      requestId,
      502,
      "SHOPIFY_IMAGE_UNAVAILABLE",
      "The Shopify image could not be downloaded.",
      true,
    );
  }
}
