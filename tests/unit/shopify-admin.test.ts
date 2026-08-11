import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ShopifyMediaRequestSchema,
  ShopifyPurchaseSchema,
  ShopifyPurchasesPageSchema,
} from "@/lib/shopify/schemas";
import {
  ShopifyAdminError,
  listPurchasedProducts,
  resolveProductMedia,
  shopifyConfigured,
} from "@/lib/shopify/admin";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn<typeof fetch>();
const originalDomain = process.env.SHOPIFY_STORE_DOMAIN;
const originalToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

type ProductFixture = {
  id: string;
  title: string;
  productType: string;
  tags: string[];
  featuredMedia: { id: string } | null;
};

function productFixture(overrides: Partial<ProductFixture> = {}): ProductFixture {
  return {
    id: "gid://shopify/Product/100",
    title: "Cream Jacket",
    productType: "Jacket",
    tags: ["cream", "outerwear"],
    featuredMedia: { id: "gid://shopify/MediaImage/200" },
    ...overrides,
  };
}

function ordersEnvelope({
  nodes,
  hasNextPage = false,
  endCursor = null,
}: {
  nodes: Array<{
    id: string;
    name: string;
    processedAt: string;
    lineItems: { nodes: Array<{ product: ProductFixture | null }> };
  }>;
  hasNextPage?: boolean;
  endCursor?: string | null;
}) {
  return {
    data: {
      orders: {
        nodes,
        pageInfo: { hasNextPage, endCursor },
      },
    },
  };
}

function orderFixture({
  id = "gid://shopify/Order/300",
  name = "#1001",
  processedAt = "2026-08-11T18:00:00.000Z",
  products = [productFixture()],
}: {
  id?: string;
  name?: string;
  processedAt?: string;
  products?: Array<ProductFixture | null>;
} = {}) {
  return {
    id,
    name,
    processedAt,
    lineItems: { nodes: products.map((product) => ({ product })) },
  };
}

function mockJson(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function requestBody(callIndex = 0) {
  const init = fetchMock.mock.calls[callIndex]?.[1];
  return JSON.parse(String(init?.body)) as {
    query: string;
    variables: Record<string, unknown>;
  };
}

function expectAdminError(
  error: unknown,
  code: ShopifyAdminError["code"],
  retryable: boolean,
) {
  expect(error).toBeInstanceOf(ShopifyAdminError);
  expect(error).toMatchObject({ code, retryable });
  expect(String(error)).not.toContain("secret-admin-token");
  expect(String(error)).not.toContain("private provider body");
}

describe("Shopify browser-safe schemas", () => {
  it("accepts only strict bounded purchase pages without a provider URL or order id", () => {
    const purchase = {
      productId: "gid://shopify/Product/100",
      mediaId: "gid://shopify/MediaImage/200",
      title: "Cream Jacket",
      productType: "Jacket",
      tags: ["cream"],
      orderName: "#1001",
      purchasedAt: "2026-08-11T18:00:00.000Z",
    };

    expect(ShopifyPurchaseSchema.parse(purchase)).toEqual(purchase);
    expect(
      ShopifyPurchasesPageSchema.parse({ purchases: [purchase], nextCursor: null }),
    ).toEqual({ purchases: [purchase], nextCursor: null });
    expect(ShopifyPurchaseSchema.safeParse({ ...purchase, url: "https://cdn.test/image" }).success).toBe(false);
    expect(ShopifyPurchaseSchema.safeParse({ ...purchase, orderId: "gid://shopify/Order/1" }).success).toBe(false);
    expect(ShopifyPurchaseSchema.safeParse({ ...purchase, tags: ["", "two"] }).success).toBe(false);
    expect(ShopifyPurchasesPageSchema.safeParse({ purchases: [], nextCursor: "x".repeat(513) }).success).toBe(false);
    expect(
      ShopifyMediaRequestSchema.safeParse({
        productId: "gid://shopify/Product/100",
        mediaId: "gid://shopify/MediaImage/200",
        url: "https://cdn.test/image",
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      productId: "gid://shopify/Product/100/extra",
      mediaId: "gid://shopify/MediaImage/200",
    },
    {
      productId: "gid://shopify/product/100",
      mediaId: "gid://shopify/MediaImage/200",
    },
    {
      productId: "gid://shopify/Product/100",
      mediaId: "gid://shopify/MediaImage/not-a-number",
    },
    {
      productId: "gid://shopify/Product/100",
      mediaId: "gid://shopify/Product/200",
    },
  ])("rejects non-exact Shopify product or media GIDs", ({ productId, mediaId }) => {
    expect(ShopifyMediaRequestSchema.safeParse({ productId, mediaId }).success).toBe(
      false,
    );
  });
});

describe("Shopify Admin client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    process.env.SHOPIFY_STORE_DOMAIN = "  YiYi-Wardrobe-Lab.MyShopify.Com  ";
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "secret-admin-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalDomain === undefined) delete process.env.SHOPIFY_STORE_DOMAIN;
    else process.env.SHOPIFY_STORE_DOMAIN = originalDomain;
    if (originalToken === undefined) delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    else process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = originalToken;
  });

  it("is explicitly marked server-only", () => {
    const source = readFileSync(
      "src/lib/shopify/admin.ts",
      "utf8",
    );
    expect(source).toMatch(/^import "server-only";/);
  });

  it("normalizes a valid store domain and uses the pinned endpoint and token header", async () => {
    mockJson(ordersEnvelope({ nodes: [] }));

    expect(shopifyConfigured()).toBe(true);
    await listPurchasedProducts({ email: "person@example.com" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://yiyi-wardrobe-lab.myshopify.com/admin/api/2026-07/graphql.json",
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-Shopify-Access-Token")).toBe(
      "secret-admin-token",
    );
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [undefined, "secret-admin-token"],
    ["store.myshopify.com", undefined],
    ["https://store.myshopify.com", "secret-admin-token"],
    ["store.myshopify.com/path", "secret-admin-token"],
    ["myshopify.com", "secret-admin-token"],
    ["store.example.com", "secret-admin-token"],
    ["two.labels.myshopify.com", "secret-admin-token"],
  ])("fails closed for missing or invalid configuration", async (domain, token) => {
    if (domain === undefined) delete process.env.SHOPIFY_STORE_DOMAIN;
    else process.env.SHOPIFY_STORE_DOMAIN = domain;
    if (token === undefined) delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    else process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = token;

    expect(shopifyConfigured()).toBe(false);
    const error = await listPurchasedProducts({ email: "person@example.com" }).catch(
      (caught: unknown) => caught,
    );
    expectAdminError(error, "NOT_CONFIGURED", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("places only the verified email filter and cursor in GraphQL variables", async () => {
    mockJson(
      ordersEnvelope({ nodes: [], hasNextPage: true, endCursor: "opaque-next-cursor" }),
    );

    await expect(
      listPurchasedProducts({ email: "person@example.com", cursor: "opaque-current-cursor" }),
    ).resolves.toEqual({ purchases: [], nextCursor: "opaque-next-cursor" });

    const body = requestBody();
    expect(body.query).toContain("orders(first: 20");
    expect(body.query).toContain("after: $cursor");
    expect(body.query).toContain("reverse: true");
    expect(body.query).toContain("sortKey: PROCESSED_AT");
    expect(body.query).toContain("query: $query");
    expect(body.query).toContain("lineItems(first: 100)");
    expect(body.variables).toEqual({
      query: "email:person@example.com financial_status:paid",
      cursor: "opaque-current-cursor",
    });
    expect(JSON.stringify(body)).not.toContain("secret-admin-token");
  });

  it("normalizes a bounded verified email before placing it in variables", async () => {
    mockJson(ordersEnvelope({ nodes: [] }));

    await listPurchasedProducts({ email: "  Person.Name@Example.COM  " });

    expect(requestBody().variables).toEqual({
      query: "email:person.name@example.com financial_status:paid",
      cursor: null,
    });
  });

  it.each([
    { name: "invalid syntax", email: "not-an-email", cursor: undefined },
    {
      name: "over 320 characters",
      email: `${"a".repeat(310)}@example.com`,
      cursor: undefined,
    },
    { name: "empty cursor", email: "person@example.com", cursor: "" },
  ])("rejects $name before making a provider request", async ({ email, cursor }) => {
    const error = await listPurchasedProducts({ email, cursor }).catch(
      (caught: unknown) => caught,
    );
    expectAdminError(error, "INVALID_SHOPIFY_RESPONSE", false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns no cursor when Shopify says there is no next page", async () => {
    mockJson(
      ordersEnvelope({ nodes: [], hasNextPage: false, endCursor: "ignored-cursor" }),
    );

    await expect(
      listPurchasedProducts({ email: "person@example.com" }),
    ).resolves.toEqual({ purchases: [], nextCursor: null });
    expect(requestBody().variables).toEqual({
      query: "email:person@example.com financial_status:paid",
      cursor: null,
    });
  });

  it("flattens newest-first, deduplicates product-media pairs, and cleans tags", async () => {
    const duplicate = productFixture({
      tags: [" cream ", "", "outerwear", "cream", "soft", "ignored"],
    });
    const withoutTags = productFixture({
      id: "gid://shopify/Product/101",
      featuredMedia: { id: "gid://shopify/MediaImage/201" },
      title: "Black Trousers",
      productType: "Pants",
      tags: [],
    });
    const noMedia = productFixture({
      id: "gid://shopify/Product/102",
      featuredMedia: null,
    });
    mockJson(
      ordersEnvelope({
        nodes: [
          orderFixture({
            id: "gid://shopify/Order/301",
            name: "#1002",
            processedAt: "2026-08-11T20:00:00.000Z",
            products: [duplicate, withoutTags, noMedia, null],
          }),
          orderFixture({
            processedAt: "2026-08-10T20:00:00.000Z",
            products: [duplicate],
          }),
        ],
      }),
    );

    const result = await listPurchasedProducts({ email: "person@example.com" });

    expect(result).toEqual({
      purchases: [
        {
          productId: "gid://shopify/Product/100",
          mediaId: "gid://shopify/MediaImage/200",
          title: "Cream Jacket",
          productType: "Jacket",
          tags: ["cream", "outerwear", "soft"],
          orderName: "#1002",
          purchasedAt: "2026-08-11T20:00:00.000Z",
        },
        {
          productId: "gid://shopify/Product/101",
          mediaId: "gid://shopify/MediaImage/201",
          title: "Black Trousers",
          productType: "Pants",
          tags: [],
          orderName: "#1002",
          purchasedAt: "2026-08-11T20:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(result)).not.toContain("gid://shopify/Order/");
    expect(JSON.stringify(result)).not.toContain("http");
  });

  it("caps a valid flattened purchase page at the first 100 newest products", async () => {
    const newestProducts = Array.from({ length: 100 }, (_, index) =>
      productFixture({
        id: `gid://shopify/Product/${1_000 + index}`,
        featuredMedia: { id: `gid://shopify/MediaImage/${2_000 + index}` },
      }),
    );
    const olderProduct = productFixture({
      id: "gid://shopify/Product/9999",
      featuredMedia: { id: "gid://shopify/MediaImage/9999" },
    });
    mockJson(
      ordersEnvelope({
        nodes: [
          orderFixture({
            processedAt: "2026-08-11T20:00:00.000Z",
            products: newestProducts,
          }),
          orderFixture({
            id: "gid://shopify/Order/302",
            name: "#1000",
            processedAt: "2026-08-10T20:00:00.000Z",
            products: [olderProduct],
          }),
        ],
      }),
    );

    const result = await listPurchasedProducts({ email: "person@example.com" });

    expect(result.purchases).toHaveLength(100);
    expect(result.purchases[0]?.productId).toBe("gid://shopify/Product/1000");
    expect(result.purchases[99]?.productId).toBe("gid://shopify/Product/1099");
    expect(result.purchases.some(({ productId }) => productId.endsWith("/9999"))).toBe(
      false,
    );
  });

  it.each([
    { status: 429, code: "SHOPIFY_UNAVAILABLE", retryable: true },
    { status: 500, code: "SHOPIFY_UNAVAILABLE", retryable: true },
    { status: 401, code: "INVALID_SHOPIFY_RESPONSE", retryable: false },
  ] as const)("maps provider HTTP $status to a bounded safe error", async ({ status, code, retryable }) => {
    fetchMock.mockResolvedValueOnce(
      new Response("private provider body", { status }),
    );

    const error = await listPurchasedProducts({ email: "person@example.com" }).catch(
      (caught: unknown) => caught,
    );
    expectAdminError(error, code, retryable);
  });

  it("maps transport rejection to a retryable safe error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("private provider body"));

    const error = await listPurchasedProducts({ email: "person@example.com" }).catch(
      (caught: unknown) => caught,
    );
    expectAdminError(error, "SHOPIFY_UNAVAILABLE", true);
  });

  it("maps an AbortSignal TimeoutError to a retryable safe error", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("private provider body", "TimeoutError"));

    const error = await listPurchasedProducts({ email: "person@example.com" }).catch(
      (caught: unknown) => caught,
    );
    expectAdminError(error, "SHOPIFY_UNAVAILABLE", true);
  });

  it.each([
    { name: "GraphQL errors", body: { errors: [{ message: "private provider body" }] } },
    { name: "malformed data", body: { data: { orders: { nodes: "not-an-array" } } } },
    { name: "invalid JSON", body: "not-json", raw: true },
  ])("rejects $name without exposing the provider response", async ({ body, raw }) => {
    if (raw) {
      fetchMock.mockResolvedValueOnce(new Response(String(body), { status: 200 }));
    } else {
      mockJson(body);
    }

    const error = await listPurchasedProducts({ email: "person@example.com" }).catch(
      (caught: unknown) => caught,
    );
    expectAdminError(error, "INVALID_SHOPIFY_RESPONSE", false);
  });

  it("rejects a next-page response without a usable cursor", async () => {
    mockJson(ordersEnvelope({ nodes: [], hasNextPage: true, endCursor: null }));

    const error = await listPurchasedProducts({ email: "person@example.com" }).catch(
      (caught: unknown) => caught,
    );
    expectAdminError(error, "INVALID_SHOPIFY_RESPONSE", false);
  });

  it("resolves only the exact requested MediaImage owned by the exact product", async () => {
    mockJson({
      data: {
        product: {
          id: "gid://shopify/Product/100",
          media: {
            nodes: [
              {},
              {
                id: "gid://shopify/MediaImage/201",
                image: {
                  url: "https://cdn.shopify.com/other.webp",
                  altText: null,
                  width: 500,
                  height: 700,
                },
              },
              {
                id: "gid://shopify/MediaImage/200",
                image: {
                  url: "https://cdn.shopify.com/requested.webp",
                  altText: "Cream jacket",
                  width: 1200,
                  height: 1600,
                },
              },
            ],
          },
        },
      },
    });

    await expect(
      resolveProductMedia({
        productId: "gid://shopify/Product/100",
        mediaId: "gid://shopify/MediaImage/200",
      }),
    ).resolves.toEqual({
      url: "https://cdn.shopify.com/requested.webp",
      altText: "Cream jacket",
      width: 1200,
      height: 1600,
    });

    const body = requestBody();
    expect(body.query).toContain("product(id: $productId)");
    expect(body.query).toContain("media(first: 100)");
    expect(body.query).toContain("... on MediaImage");
    expect(body.variables).toEqual({ productId: "gid://shopify/Product/100" });
  });

  it.each([
    {
      name: "missing product",
      product: null,
    },
    {
      name: "mismatched product",
      product: {
        id: "gid://shopify/Product/999",
        media: { nodes: [] },
      },
    },
    {
      name: "missing requested media",
      product: {
        id: "gid://shopify/Product/100",
        media: { nodes: [] },
      },
    },
  ])("rejects $name as not found without leaking product data", async ({ product }) => {
    mockJson({ data: { product } });

    const error = await resolveProductMedia({
      productId: "gid://shopify/Product/100",
      mediaId: "gid://shopify/MediaImage/200",
    }).catch((caught: unknown) => caught);
    expectAdminError(error, "SHOPIFY_MEDIA_NOT_FOUND", false);
  });

  it("treats a malformed media payload as an invalid provider response", async () => {
    mockJson({
      data: {
        product: {
          id: "gid://shopify/Product/100",
          media: {
            nodes: [
              {
                id: "gid://shopify/MediaImage/200",
                image: { url: "private provider body" },
              },
            ],
          },
        },
      },
    });

    const error = await resolveProductMedia({
      productId: "gid://shopify/Product/100",
      mediaId: "gid://shopify/MediaImage/200",
    }).catch((caught: unknown) => caught);
    expectAdminError(error, "INVALID_SHOPIFY_RESPONSE", false);
  });

  it.each([
    { dimension: "width", width: 12_001, height: 1_600 },
    { dimension: "height", width: 1_200, height: 12_001 },
  ])("rejects media with $dimension above 12,000", async ({ width, height }) => {
    mockJson({
      data: {
        product: {
          id: "gid://shopify/Product/100",
          media: {
            nodes: [
              {
                id: "gid://shopify/MediaImage/200",
                image: {
                  url: "https://cdn.shopify.com/requested.webp",
                  altText: null,
                  width,
                  height,
                },
              },
            ],
          },
        },
      },
    });

    const error = await resolveProductMedia({
      productId: "gid://shopify/Product/100",
      mediaId: "gid://shopify/MediaImage/200",
    }).catch((caught: unknown) => caught);
    expectAdminError(error, "INVALID_SHOPIFY_RESPONSE", false);
  });

  it("rejects an invalid exact media request without fetching", async () => {
    const error = await resolveProductMedia({
      productId: "gid://shopify/Product/100/extra",
      mediaId: "gid://shopify/MediaImage/200",
    }).catch((caught: unknown) => caught);

    expectAdminError(error, "SHOPIFY_MEDIA_NOT_FOUND", false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
