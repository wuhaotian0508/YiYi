import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCloudSessionMock } = vi.hoisted(() => ({
  getCloudSessionMock: vi.fn(),
}));

vi.mock("@/lib/cloud/auth", () => ({ getCloudSession: getCloudSessionMock }));

import { ShopifyPurchaseImport } from "@/components/wardrobe/shopify-purchase-import";

const purchases = Array.from({ length: 9 }, (_, index) => ({
  productId: `gid://shopify/Product/${100 + index}`,
  mediaId: `gid://shopify/MediaImage/${200 + index}`,
  title: `AI Test — Item ${index + 1}`,
  productType: index === 0 ? "Jacket" : "",
  tags: index === 0 ? [] : ["test"],
  orderName: "#1001",
  purchasedAt: "2026-08-11T18:00:00.000Z",
}));

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ShopifyPurchaseImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCloudSessionMock.mockResolvedValue({ access_token: "supabase-access-token" });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => `blob:test-${blob.size}-${Math.random()}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a sign-in requirement without requesting order data", async () => {
    getCloudSessionMock.mockResolvedValue(null);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    render(<ShopifyPurchaseImport onCancel={vi.fn()} onFiles={vi.fn()} />);

    expect(await screen.findByText("Sign in to view purchases")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in with email" })).toHaveAttribute(
      "href",
      "/sign-in?next=/wardrobe/add",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads Blob previews, labels Shopify metadata as suggestions, and returns Files", async () => {
    const imageBlob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
      type: "image/jpeg",
    });
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("/purchases")) {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer supabase-access-token",
        );
        return jsonResponse({
          requestId: "123e4567-e89b-42d3-a456-426614174000",
          purchases: purchases.slice(0, 1),
          nextCursor: null,
        });
      }
      expect(String(input)).toBe("/api/wardrobe/shopify/image");
      expect(init?.method).toBe("POST");
      return new Response(await imageBlob.arrayBuffer(), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onFiles = vi.fn();

    render(<ShopifyPurchaseImport onCancel={vi.fn()} onFiles={onFiles} />);

    expect(await screen.findByText("AI Test — Item 1")).toBeInTheDocument();
    expect(screen.getByText("Jacket suggestion")).toBeInTheDocument();
    expect(screen.getByText("No Shopify tags")).toBeInTheDocument();
    const select = await screen.findByRole("button", { name: "Select AI Test — Item 1" });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("button", { name: "Import 1 item" }));

    expect(onFiles).toHaveBeenCalledTimes(1);
    const files = onFiles.mock.calls[0]?.[0] as File[];
    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0]?.type).toBe("image/jpeg");
    expect(files[0]?.name).not.toContain("AI Test");
  });

  it("isolates a failed image and limits selection to eight", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("/purchases")) {
        return jsonResponse({
          requestId: "123e4567-e89b-42d3-a456-426614174000",
          purchases,
          nextCursor: null,
        });
      }
      const body = JSON.parse(String(init?.body)) as { productId: string };
      if (body.productId.endsWith("/108")) {
        return jsonResponse(
          {
            requestId: "123e4567-e89b-42d3-a456-426614174000",
            error: { code: "SHOPIFY_IMAGE_UNAVAILABLE", message: "Unavailable", retryable: true },
          },
          502,
        );
      }
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]).buffer, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ShopifyPurchaseImport onCancel={vi.fn()} onFiles={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^Select AI Test/ })).toHaveLength(8);
    });
    for (const button of screen.getAllByRole("button", { name: /^Select AI Test/ })) {
      fireEvent.click(button);
    }
    expect(screen.getByText("8 of 8 selected")).toBeInTheDocument();
    expect(await screen.findByText("Image unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry AI Test — Item 9 image" })).toBeInTheDocument();
  });
});
