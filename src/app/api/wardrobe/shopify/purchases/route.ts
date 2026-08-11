import { z } from "zod";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { takeRateLimit } from "@/lib/api/rate-limit";
import { verifiedCloudUser } from "@/lib/cloud/server-auth";
import {
  listPurchasedProducts,
  ShopifyAdminError,
  shopifyConfigured,
} from "@/lib/shopify/admin";

export const runtime = "nodejs";

const cursorSchema = z.string().min(1).max(512);

function authError(requestId: string, code: "UNAUTHORIZED" | "CLOUD_NOT_CONFIGURED") {
  return code === "UNAUTHORIZED"
    ? apiError(requestId, 401, code, "Sign in to import your Shopify purchases.")
    : apiError(requestId, 503, code, "Account sign-in is not configured.", true);
}

export async function GET(request: Request) {
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

  const rawCursor = new URL(request.url).searchParams.get("cursor");
  const cursor = rawCursor === null ? undefined : cursorSchema.safeParse(rawCursor);
  if (cursor !== undefined && !cursor.success) {
    return apiError(requestId, 400, "INVALID_CURSOR", "The purchase page was invalid.");
  }

  const rate = await takeRateLimit(request, "shopify-purchases", 30);
  if (!rate.available) {
    return apiError(
      requestId,
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "Shopify purchase import is temporarily unavailable.",
      true,
    );
  }
  if (!rate.allowed) {
    return apiError(
      requestId,
      429,
      "RATE_LIMITED",
      "Shopify purchases were refreshed too often. Try again shortly.",
      true,
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  try {
    const page = await listPurchasedProducts({
      email: user.email,
      cursor: cursor?.data,
    });
    return noStoreJson({ requestId, ...page });
  } catch (error) {
    if (error instanceof ShopifyAdminError) {
      const notConfigured = error.code === "NOT_CONFIGURED";
      return apiError(
        requestId,
        notConfigured ? 503 : 502,
        notConfigured ? "SHOPIFY_NOT_CONFIGURED" : "SHOPIFY_PURCHASES_UNAVAILABLE",
        notConfigured
          ? "Shopify purchase import is not configured."
          : "Your Shopify purchases could not be loaded.",
        error.retryable,
      );
    }
    return apiError(
      requestId,
      502,
      "SHOPIFY_PURCHASES_UNAVAILABLE",
      "Your Shopify purchases could not be loaded.",
      true,
    );
  }
}
