import { z } from "zod";
import { ShopifyPurchasesPageSchema, type ShopifyPurchase } from "@/lib/shopify/schemas";

const accessTokenSchema = z.string().min(1).max(16_384);
const purchasesResponseSchema = ShopifyPurchasesPageSchema.extend({
  requestId: z.string().uuid(),
}).strict();
const apiErrorSchema = z
  .object({
    requestId: z.string().uuid(),
    error: z
      .object({
        code: z.string().min(1).max(80),
        message: z.string().min(1).max(300),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

const allowedImageMimes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

export class ShopifyImportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ShopifyImportError";
  }
}

function authorization(accessToken: string) {
  const parsed = accessTokenSchema.safeParse(accessToken);
  if (!parsed.success) {
    throw new ShopifyImportError("Sign in to view your Shopify purchases.", "UNAUTHORIZED", false);
  }
  return { Authorization: `Bearer ${parsed.data}` };
}

async function responseFailure(response: Response, fallback: string) {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  if (parsed.success) {
    return new ShopifyImportError(
      parsed.data.error.message,
      parsed.data.error.code,
      parsed.data.error.retryable,
    );
  }
  return new ShopifyImportError(fallback, "INVALID_SHOPIFY_RESPONSE", response.status >= 500);
}

export async function loadShopifyPurchases(accessToken: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`/api/wardrobe/shopify/purchases${query}`, {
    method: "GET",
    headers: authorization(accessToken),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await responseFailure(response, "Your Shopify purchases could not be loaded.");
  }
  const parsed = purchasesResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new ShopifyImportError(
      "Your Shopify purchases could not be loaded.",
      "INVALID_SHOPIFY_RESPONSE",
      false,
    );
  }
  return parsed.data;
}

export async function downloadShopifyPurchaseImage(
  accessToken: string,
  purchase: Pick<ShopifyPurchase, "productId" | "mediaId">,
) {
  const response = await fetch("/api/wardrobe/shopify/image", {
    method: "POST",
    headers: {
      ...authorization(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ productId: purchase.productId, mediaId: purchase.mediaId }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await responseFailure(response, "This Shopify image could not be downloaded.");
  }
  const blob = await response.blob();
  if (!allowedImageMimes.has(blob.type) || blob.size < 1 || blob.size > 20 * 1024 * 1024) {
    throw new ShopifyImportError(
      "This Shopify image could not be imported.",
      "INVALID_SHOPIFY_IMAGE",
      false,
    );
  }
  return blob;
}

export function shopifyImageFile(blob: Blob, index: number) {
  const extension =
    blob.type === "image/png"
      ? "png"
      : blob.type === "image/webp"
        ? "webp"
        : blob.type === "image/heic"
          ? "heic"
          : "jpg";
  return new File([blob], `shopify-purchase-${index + 1}.${extension}`, {
    type: blob.type,
    lastModified: Date.now(),
  });
}
