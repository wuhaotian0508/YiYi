import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifiedCloudUserMock,
  listPurchasedProductsMock,
  resolveProductMediaMock,
  shopifyConfiguredMock,
  takeRateLimitMock,
  metadataMock,
} = vi.hoisted(() => ({
  verifiedCloudUserMock: vi.fn(),
  listPurchasedProductsMock: vi.fn(),
  resolveProductMediaMock: vi.fn(),
  shopifyConfiguredMock: vi.fn(),
  takeRateLimitMock: vi.fn(),
  metadataMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloud/server-auth", () => ({
  verifiedCloudUser: verifiedCloudUserMock,
}));
vi.mock("@/lib/shopify/admin", () => ({
  ShopifyAdminError: class ShopifyAdminError extends Error {
    constructor(
      readonly code: string,
      readonly retryable = false,
    ) {
      super(code);
    }
  },
  listPurchasedProducts: listPurchasedProductsMock,
  resolveProductMedia: resolveProductMediaMock,
  shopifyConfigured: shopifyConfiguredMock,
}));
vi.mock("@/lib/api/rate-limit", () => ({
  takeRateLimit: takeRateLimitMock,
}));
vi.mock("@/lib/api/responses", () => ({
  noStoreJson: (body: unknown, status = 200, headers?: HeadersInit) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store, max-age=0", ...headers },
    }),
  apiError: (
    requestId: string,
    status: number,
    code: string,
    message: string,
    retryable = false,
    headers?: HeadersInit,
  ) =>
    Response.json(
      { requestId, error: { code, message, retryable } },
      { status, headers: { "Cache-Control": "no-store, max-age=0", ...headers } },
    ),
}));
vi.mock("@/lib/images/sharp-runtime", () => ({
  loadSharp: vi.fn(async () =>
    vi.fn(() => ({ metadata: metadataMock })),
  ),
  isImageRuntimeUnavailable: vi.fn(() => false),
}));

import { GET as listPurchases } from "@/app/api/wardrobe/shopify/purchases/route";
import { POST as fetchImage } from "@/app/api/wardrobe/shopify/image/route";

const validPurchase = {
  productId: "gid://shopify/Product/100",
  mediaId: "gid://shopify/MediaImage/200",
  title: "AI Test — Cream Button Jacket",
  productType: "Jacket",
  tags: [],
  orderName: "#1001",
  purchasedAt: "2026-08-11T18:00:00.000Z",
};

const validJpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

function request(path: string, init?: RequestInit) {
  return new Request(`https://example.test${path}`, {
    headers: {
      Authorization: "Bearer supabase-token",
      "x-yiyi-client-session": "123e4567-e89b-42d3-a456-426614174000",
      ...init?.headers,
    },
    ...init,
  });
}

function imageRequest(body: unknown = {
  productId: validPurchase.productId,
  mediaId: validPurchase.mediaId,
}) {
  return request("/api/wardrobe/shopify/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function responseError(response: Response) {
  return (await response.json()) as {
    requestId: string;
    error: { code: string; message: string; retryable: boolean };
  };
}

describe("Shopify purchase routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifiedCloudUserMock.mockResolvedValue({ ok: true, email: "person@example.com" });
    shopifyConfiguredMock.mockReturnValue(true);
    takeRateLimitMock.mockResolvedValue({
      available: true,
      allowed: true,
      retryAfterSeconds: 0,
      mode: "per-instance",
    });
    listPurchasedProductsMock.mockResolvedValue({
      purchases: [validPurchase],
      nextCursor: null,
    });
    resolveProductMediaMock.mockResolvedValue({
      url: "https://cdn.shopify.com/s/files/1/test.jpg",
      altText: null,
      width: 1200,
      height: 1600,
    });
    metadataMock.mockResolvedValue({
      format: "jpeg",
      width: 1200,
      height: 1600,
      pages: 1,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(validJpeg.buffer as ArrayBuffer, {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(validJpeg.byteLength),
          },
        })),
    );
  });

  it("requires a verified cloud session before querying Shopify", async () => {
    verifiedCloudUserMock.mockResolvedValue({ ok: false, code: "UNAUTHORIZED" });

    const response = await listPurchases(request("/api/wardrobe/shopify/purchases"));

    expect(response.status).toBe(401);
    expect((await responseError(response)).error.code).toBe("UNAUTHORIZED");
    expect(listPurchasedProductsMock).not.toHaveBeenCalled();
  });

  it("lists paid purchases using only the server-verified email", async () => {
    const response = await listPurchases(
      request("/api/wardrobe/shopify/purchases?cursor=opaque-cursor"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(listPurchasedProductsMock).toHaveBeenCalledWith({
      email: "person@example.com",
      cursor: "opaque-cursor",
    });
    const payload = await response.json();
    expect(payload).toMatchObject({ purchases: [validPurchase], nextCursor: null });
    expect(JSON.stringify(payload)).not.toContain("person@example.com");
  });

  it.each(["", "x".repeat(513)])("rejects an invalid cursor", async (cursor) => {
    const response = await listPurchases(
      request(`/api/wardrobe/shopify/purchases?cursor=${encodeURIComponent(cursor)}`),
    );

    expect(response.status).toBe(400);
    expect((await responseError(response)).error.code).toBe("INVALID_CURSOR");
    expect(listPurchasedProductsMock).not.toHaveBeenCalled();
  });

  it("returns a bounded configuration error", async () => {
    shopifyConfiguredMock.mockReturnValue(false);

    const response = await listPurchases(request("/api/wardrobe/shopify/purchases"));

    expect(response.status).toBe(503);
    expect((await responseError(response)).error.code).toBe("SHOPIFY_NOT_CONFIGURED");
  });

  it("rejects an invalid image request before resolving provider media", async () => {
    const response = await fetchImage(imageRequest({
      productId: validPurchase.productId,
      mediaId: "gid://shopify/Product/200",
    }));

    expect(response.status).toBe(400);
    expect((await responseError(response)).error.code).toBe("INVALID_IMAGE_REQUEST");
    expect(resolveProductMediaMock).not.toHaveBeenCalled();
  });

  it.each([
    "http://cdn.shopify.com/s/files/1/test.jpg",
    "https://cdn.shopify.com.evil.test/test.jpg",
    "https://example.test/test.jpg",
    "https://user:password@cdn.shopify.com/test.jpg",
  ])("refuses an unsafe resolved media URL", async (url) => {
    resolveProductMediaMock.mockResolvedValue({
      url,
      altText: null,
      width: 1200,
      height: 1600,
    });

    const response = await fetchImage(imageRequest());

    expect(response.status).toBe(502);
    expect((await responseError(response)).error.code).toBe("UNSAFE_SHOPIFY_IMAGE");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses CDN redirects", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://example.test" } }),
    );

    const response = await fetchImage(imageRequest());

    expect(response.status).toBe(502);
    expect((await responseError(response)).error.code).toBe("SHOPIFY_IMAGE_UNAVAILABLE");
    expect(fetch).toHaveBeenCalledWith(
      "https://cdn.shopify.com/s/files/1/test.jpg",
      expect.objectContaining({ redirect: "manual", cache: "no-store" }),
    );
  });

  it.each([
    ["text/html", validJpeg, "UNSUPPORTED_SHOPIFY_IMAGE"],
    ["image/png", validJpeg, "UNSUPPORTED_SHOPIFY_IMAGE"],
    ["image/jpeg", new Uint8Array([1, 2, 3, 4]), "UNSUPPORTED_SHOPIFY_IMAGE"],
  ])("checks declared type and magic bytes", async (contentType, bytes, code) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(bytes.buffer as ArrayBuffer, { status: 200, headers: { "content-type": contentType } }),
    );

    const response = await fetchImage(imageRequest());

    expect(response.status).toBe(415);
    expect((await responseError(response)).error.code).toBe(code);
  });

  it("rejects a declared image larger than 20 MB without reading it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(validJpeg.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(20 * 1024 * 1024 + 1),
        },
      }),
    );

    const response = await fetchImage(imageRequest());

    expect(response.status).toBe(413);
    expect((await responseError(response)).error.code).toBe("SHOPIFY_IMAGE_TOO_LARGE");
  });

  it.each([
    { width: 12_001, height: 1, pages: 1 },
    { width: 10_000, height: 6_001, pages: 1 },
    { width: 100, height: 100, pages: 2 },
  ])("rejects unsafe image geometry %#", async (metadata) => {
    metadataMock.mockResolvedValue(metadata);

    const response = await fetchImage(imageRequest());

    expect(response.status).toBe(415);
    expect((await responseError(response)).error.code).toBe("INVALID_SHOPIFY_IMAGE");
  });

  it("returns validated raw bytes without provider identifiers or caching", async () => {
    const response = await fetchImage(imageRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(validJpeg);
    expect(response.headers.get("x-shopify-product-id")).toBeNull();
  });
});
