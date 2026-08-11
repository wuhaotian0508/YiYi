import "server-only";

import { z } from "zod";
import {
  ShopifyMediaRequestSchema,
  ShopifyPurchasesPageSchema,
  type ShopifyPurchase,
  type ShopifyPurchasesPage,
} from "@/lib/shopify/schemas";

const SHOPIFY_API_VERSION = "2026-07";
const SHOPIFY_TIMEOUT_MS = 15_000;

export type ShopifyAdminErrorCode =
  | "NOT_CONFIGURED"
  | "SHOPIFY_UNAVAILABLE"
  | "INVALID_SHOPIFY_RESPONSE"
  | "SHOPIFY_MEDIA_NOT_FOUND";

const errorDetails: Record<
  ShopifyAdminErrorCode,
  { message: string; retryable: boolean }
> = {
  NOT_CONFIGURED: {
    message: "Shopify Admin is not configured.",
    retryable: true,
  },
  SHOPIFY_UNAVAILABLE: {
    message: "Shopify Admin is temporarily unavailable.",
    retryable: true,
  },
  INVALID_SHOPIFY_RESPONSE: {
    message: "Shopify Admin returned an invalid response.",
    retryable: false,
  },
  SHOPIFY_MEDIA_NOT_FOUND: {
    message: "The requested Shopify media was not found.",
    retryable: false,
  },
};

export class ShopifyAdminError extends Error {
  readonly code: ShopifyAdminErrorCode;
  readonly retryable: boolean;

  constructor(code: ShopifyAdminErrorCode) {
    const details = errorDetails[code];
    super(details.message);
    this.name = "ShopifyAdminError";
    this.code = code;
    this.retryable = details.retryable;
  }
}

const shopDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/);
const adminTokenSchema = z.string().trim().min(1).max(512);
const cursorSchema = z.string().min(1).max(512);
const listRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(320).email(),
    cursor: cursorSchema.optional(),
  })
  .strict();

type ShopifyConfiguration = {
  endpoint: string;
  token: string;
};

function shopifyConfiguration(): ShopifyConfiguration | null {
  const domain = shopDomainSchema.safeParse(process.env.SHOPIFY_STORE_DOMAIN);
  const token = adminTokenSchema.safeParse(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN);
  if (!domain.success || !token.success) return null;

  return {
    endpoint: `https://${domain.data}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    token: token.data,
  };
}

export function shopifyConfigured(): boolean {
  return shopifyConfiguration() !== null;
}

const graphQLErrorSchema = z
  .object({
    message: z.string(),
    locations: z
      .array(
        z
          .object({
            line: z.number().int().positive(),
            column: z.number().int().positive(),
          })
          .strict(),
      )
      .optional(),
    path: z.array(z.union([z.string(), z.number().int()])).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const shopifyOrderIdSchema = z.string().regex(/^gid:\/\/shopify\/Order\/\d+$/);
const shopifyProductIdSchema = z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/);
const shopifyMediaImageIdSchema = z
  .string()
  .regex(/^gid:\/\/shopify\/MediaImage\/\d+$/);

const providerProductSchema = z
  .object({
    id: shopifyProductIdSchema,
    title: z.string().trim().min(1).max(200),
    productType: z.string().trim().max(100),
    tags: z.array(z.string().max(80)).max(250),
    featuredMedia: z
      .object({ id: shopifyMediaImageIdSchema })
      .strict()
      .nullable(),
  })
  .strict();

const orderDataSchema = z
  .object({
    orders: z
      .object({
        nodes: z
          .array(
            z
              .object({
                id: shopifyOrderIdSchema,
                name: z.string().trim().min(1).max(40),
                processedAt: z.string().datetime(),
                lineItems: z
                  .object({
                    nodes: z
                      .array(
                        z
                          .object({ product: providerProductSchema.nullable() })
                          .strict(),
                      )
                      .max(100),
                  })
                  .strict(),
              })
              .strict(),
          )
          .max(20),
        pageInfo: z
          .object({
            hasNextPage: z.boolean(),
            endCursor: cursorSchema.nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const orderEnvelopeSchema = z
  .object({
    data: orderDataSchema.optional(),
    errors: z.array(graphQLErrorSchema).min(1).optional(),
    extensions: z.unknown().optional(),
  })
  .strict();

const mediaImageSchema = z
  .object({
    id: shopifyMediaImageIdSchema,
    image: z
      .object({
        url: z.string().url().max(2_048),
        altText: z.string().max(500).nullable(),
        width: z.number().int().positive().max(12_000),
        height: z.number().int().positive().max(12_000),
      })
      .strict(),
  })
  .strict();
const nonImageMediaSchema = z.object({}).strict();

const mediaDataSchema = z
  .object({
    product: z
      .object({
        id: shopifyProductIdSchema,
        media: z
          .object({
            nodes: z.array(z.union([mediaImageSchema, nonImageMediaSchema])).max(100),
          })
          .strict(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const mediaEnvelopeSchema = z
  .object({
    data: mediaDataSchema.optional(),
    errors: z.array(graphQLErrorSchema).min(1).optional(),
    extensions: z.unknown().optional(),
  })
  .strict();

const resolvedMediaSchema = z
  .object({
    url: z.string().url().max(2_048),
    altText: z.string().max(500).nullable(),
    width: z.number().int().positive().max(12_000),
    height: z.number().int().positive().max(12_000),
  })
  .strict();

export type ResolvedShopifyMedia = z.infer<typeof resolvedMediaSchema>;

const LIST_PURCHASED_PRODUCTS_QUERY = `
  query PurchasedProducts($query: String!, $cursor: String) {
    orders(first: 20, after: $cursor, reverse: true, sortKey: PROCESSED_AT, query: $query) {
      nodes {
        id
        name
        processedAt
        lineItems(first: 100) {
          nodes {
            product {
              id
              title
              productType
              tags
              featuredMedia {
                ... on MediaImage {
                  id
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const RESOLVE_PRODUCT_MEDIA_QUERY = `
  query ResolveProductMedia($productId: ID!) {
    product(id: $productId) {
      id
      media(first: 100) {
        nodes {
          ... on MediaImage {
            id
            image {
              url
              altText
              width
              height
            }
          }
        }
      }
    }
  }
`;

async function requestShopify(
  configuration: ShopifyConfiguration,
  query: string,
  variables: Record<string, string | null>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(configuration.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": configuration.token,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(SHOPIFY_TIMEOUT_MS),
    });
  } catch {
    throw new ShopifyAdminError("SHOPIFY_UNAVAILABLE");
  }

  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw new ShopifyAdminError("SHOPIFY_UNAVAILABLE");
    }
    throw new ShopifyAdminError("INVALID_SHOPIFY_RESPONSE");
  }

  try {
    return await response.json();
  } catch {
    throw new ShopifyAdminError("INVALID_SHOPIFY_RESPONSE");
  }
}

function configuredClient(): ShopifyConfiguration {
  const configuration = shopifyConfiguration();
  if (!configuration) throw new ShopifyAdminError("NOT_CONFIGURED");
  return configuration;
}

function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(tag);
    if (cleaned.length === 3) break;
  }
  return cleaned;
}

function browserSafePurchase(
  purchase: ShopifyPurchase & { sequence: number },
): ShopifyPurchase {
  return {
    productId: purchase.productId,
    mediaId: purchase.mediaId,
    title: purchase.title,
    productType: purchase.productType,
    tags: purchase.tags,
    orderName: purchase.orderName,
    purchasedAt: purchase.purchasedAt,
  };
}

export async function listPurchasedProducts(input: {
  email: string;
  cursor?: string;
}): Promise<ShopifyPurchasesPage> {
  const request = listRequestSchema.safeParse(input);
  if (!request.success) {
    throw new ShopifyAdminError("INVALID_SHOPIFY_RESPONSE");
  }

  const configuration = configuredClient();
  const rawEnvelope = await requestShopify(
    configuration,
    LIST_PURCHASED_PRODUCTS_QUERY,
    {
      query: `email:${request.data.email} financial_status:paid`,
      cursor: request.data.cursor ?? null,
    },
  );
  const envelope = orderEnvelopeSchema.safeParse(rawEnvelope);
  if (!envelope.success || envelope.data.errors || !envelope.data.data) {
    throw new ShopifyAdminError("INVALID_SHOPIFY_RESPONSE");
  }

  const { nodes, pageInfo } = envelope.data.data.orders;
  if (pageInfo.hasNextPage && pageInfo.endCursor === null) {
    throw new ShopifyAdminError("INVALID_SHOPIFY_RESPONSE");
  }

  const flattened: Array<ShopifyPurchase & { sequence: number }> = [];
  let sequence = 0;
  for (const order of nodes) {
    for (const lineItem of order.lineItems.nodes) {
      const product = lineItem.product;
      if (!product?.featuredMedia) continue;
      flattened.push({
        productId: product.id,
        mediaId: product.featuredMedia.id,
        title: product.title,
        productType: product.productType,
        tags: cleanTags(product.tags),
        orderName: order.name,
        purchasedAt: order.processedAt,
        sequence,
      });
      sequence += 1;
    }
  }

  flattened.sort((left, right) => {
    const byPurchaseDate = Date.parse(right.purchasedAt) - Date.parse(left.purchasedAt);
    return byPurchaseDate || left.sequence - right.sequence;
  });

  const seen = new Set<string>();
  const purchases: ShopifyPurchase[] = [];
  for (const entry of flattened) {
    const purchase = browserSafePurchase(entry);
    const key = `${purchase.productId}\u0000${purchase.mediaId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    purchases.push(purchase);
    if (purchases.length === 100) break;
  }

  const result = ShopifyPurchasesPageSchema.safeParse({
    purchases,
    nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
  });
  if (!result.success) {
    throw new ShopifyAdminError("INVALID_SHOPIFY_RESPONSE");
  }
  return result.data;
}

export async function resolveProductMedia(
  input: z.input<typeof ShopifyMediaRequestSchema>,
): Promise<ResolvedShopifyMedia> {
  const request = ShopifyMediaRequestSchema.safeParse(input);
  if (!request.success) {
    throw new ShopifyAdminError("SHOPIFY_MEDIA_NOT_FOUND");
  }

  const configuration = configuredClient();
  const rawEnvelope = await requestShopify(
    configuration,
    RESOLVE_PRODUCT_MEDIA_QUERY,
    { productId: request.data.productId },
  );
  const envelope = mediaEnvelopeSchema.safeParse(rawEnvelope);
  if (!envelope.success || envelope.data.errors || !envelope.data.data) {
    throw new ShopifyAdminError("INVALID_SHOPIFY_RESPONSE");
  }

  const product = envelope.data.data.product;
  if (!product || product.id !== request.data.productId) {
    throw new ShopifyAdminError("SHOPIFY_MEDIA_NOT_FOUND");
  }

  const requestedMedia = product.media.nodes.find(
    (media): media is z.infer<typeof mediaImageSchema> =>
      "id" in media && media.id === request.data.mediaId,
  );
  if (!requestedMedia) {
    throw new ShopifyAdminError("SHOPIFY_MEDIA_NOT_FOUND");
  }

  const result = resolvedMediaSchema.safeParse(requestedMedia.image);
  if (!result.success) {
    throw new ShopifyAdminError("INVALID_SHOPIFY_RESPONSE");
  }
  return result.data;
}
