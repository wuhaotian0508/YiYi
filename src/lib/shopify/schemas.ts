import { z } from "zod";

const shopifyProductIdSchema = z
  .string()
  .regex(/^gid:\/\/shopify\/Product\/\d+$/);
const shopifyMediaImageIdSchema = z
  .string()
  .regex(/^gid:\/\/shopify\/MediaImage\/\d+$/);

export const ShopifyPurchaseSchema = z
  .object({
    productId: shopifyProductIdSchema,
    mediaId: shopifyMediaImageIdSchema,
    title: z.string().trim().min(1).max(200),
    productType: z.string().trim().max(100),
    tags: z.array(z.string().trim().min(1).max(80)).max(3),
    orderName: z.string().trim().min(1).max(40),
    purchasedAt: z.string().datetime(),
  })
  .strict();

export const ShopifyPurchasesPageSchema = z
  .object({
    purchases: z.array(ShopifyPurchaseSchema).max(100),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict();

export const ShopifyMediaRequestSchema = z
  .object({
    productId: shopifyProductIdSchema,
    mediaId: shopifyMediaImageIdSchema,
  })
  .strict();

export type ShopifyPurchase = z.infer<typeof ShopifyPurchaseSchema>;
export type ShopifyPurchasesPage = z.infer<typeof ShopifyPurchasesPageSchema>;
export type ShopifyMediaRequest = z.infer<typeof ShopifyMediaRequestSchema>;
