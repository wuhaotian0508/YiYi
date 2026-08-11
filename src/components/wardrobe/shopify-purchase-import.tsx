"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, RefreshCw, ShoppingBag } from "lucide-react";
import { PrimaryButton, SecondaryButton } from "@/components/ui/buttons";
import { getCloudSession } from "@/lib/cloud/auth";
import type { ShopifyPurchase } from "@/lib/shopify/schemas";
import {
  downloadShopifyPurchaseImage,
  loadShopifyPurchases,
  shopifyImageFile,
  ShopifyImportError,
} from "@/lib/wardrobe/shopify-client";

type PurchaseImage =
  | { status: "loading" }
  | { status: "ready"; blob: Blob; objectUrl: string }
  | { status: "error"; retryable: boolean };

export type ShopifyPurchaseImportProps = {
  onCancel(): void;
  onFiles(files: File[]): void;
};

const MAX_SELECTED = 8;

function purchaseKey(purchase: ShopifyPurchase) {
  return `${purchase.productId}\u0000${purchase.mediaId}`;
}

function purchaseDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function ShopifyPurchaseImport({ onCancel, onFiles }: ShopifyPurchaseImportProps) {
  const [status, setStatus] = useState<"loading" | "signed-out" | "ready" | "error">("loading");
  const [accessToken, setAccessToken] = useState("");
  const [purchases, setPurchases] = useState<ShopifyPurchase[]>([]);
  const [images, setImages] = useState<Record<string, PurchaseImage>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const objectUrls = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
  }, []);

  const loadImage = useCallback(async (purchase: ShopifyPurchase, token: string) => {
    const key = purchaseKey(purchase);
    setImages((current) => ({ ...current, [key]: { status: "loading" } }));
    try {
      const blob = await downloadShopifyPurchaseImage(token, purchase);
      if (!mounted.current) return;
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.current.add(objectUrl);
      setImages((current) => {
        const previous = current[key];
        if (previous?.status === "ready") {
          URL.revokeObjectURL(previous.objectUrl);
          objectUrls.current.delete(previous.objectUrl);
        }
        return { ...current, [key]: { status: "ready", blob, objectUrl } };
      });
    } catch (error) {
      if (!mounted.current) return;
      setImages((current) => ({
        ...current,
        [key]: {
          status: "error",
          retryable: error instanceof ShopifyImportError ? error.retryable : true,
        },
      }));
    }
  }, []);

  const loadList = useCallback(async () => {
    setStatus("loading");
    setMessage("");
    setSelected([]);
    setImages({});
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
    try {
      const session = await getCloudSession();
      if (!session) {
        if (mounted.current) setStatus("signed-out");
        return;
      }
      const token = session.access_token;
      const page = await loadShopifyPurchases(token);
      if (!mounted.current) return;
      setAccessToken(token);
      setPurchases(page.purchases);
      setStatus("ready");
      for (let index = 0; index < page.purchases.length; index += 3) {
        if (!mounted.current) return;
        await Promise.all(
          page.purchases.slice(index, index + 3).map((purchase) => loadImage(purchase, token)),
        );
      }
    } catch (error) {
      if (!mounted.current) return;
      setMessage(
        error instanceof ShopifyImportError
          ? error.message
          : "Your Shopify purchases could not be loaded.",
      );
      setStatus("error");
    }
  }, [loadImage]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  function toggle(purchase: ShopifyPurchase) {
    const key = purchaseKey(purchase);
    if (images[key]?.status !== "ready") return;
    setSelected((current) => {
      if (current.includes(key)) return current.filter((value) => value !== key);
      if (current.length >= MAX_SELECTED) return current;
      return [...current, key];
    });
  }

  function importSelected() {
    const files = selected.flatMap((key, index) => {
      const image = images[key];
      return image?.status === "ready" ? [shopifyImageFile(image.blob, index)] : [];
    });
    if (files.length > 0) onFiles(files);
  }

  if (status === "loading") {
    return <section className="shopify-import-state" aria-live="polite">
      <ShoppingBag size={30} />
      <h1>Loading your purchases…</h1>
      <p>YiYi is checking paid orders from this store.</p>
    </section>;
  }

  if (status === "signed-out") {
    return <section className="shopify-import-state">
      <ShoppingBag size={30} />
      <h1>Sign in to view purchases</h1>
      <p>YiYi uses your verified email to find your paid Shopify orders.</p>
      <a className="primary-button" href="/sign-in?next=/wardrobe/add">Sign in with email</a>
      <SecondaryButton onClick={onCancel}>Back</SecondaryButton>
    </section>;
  }

  if (status === "error") {
    return <section className="shopify-import-state">
      <ShoppingBag size={30} />
      <h1>Purchases unavailable</h1>
      <p role="alert">{message}</p>
      <PrimaryButton onClick={() => void loadList()}><RefreshCw size={17} />Try again</PrimaryButton>
      <SecondaryButton onClick={onCancel}>Back</SecondaryButton>
    </section>;
  }

  if (purchases.length === 0) {
    return <section className="shopify-import-state">
      <ShoppingBag size={30} />
      <h1>No paid purchases found</h1>
      <p>Use the same verified email as your Shopify order.</p>
      <SecondaryButton onClick={onCancel}>Back</SecondaryButton>
    </section>;
  }

  return <section className="shopify-import">
    <header className="shopify-import-header">
      <button className="icon-button" type="button" onClick={onCancel} aria-label="Back to add clothes">
        <ChevronLeft />
      </button>
      <div>
        <h1>Import Shopify purchases</h1>
        <p>Choose up to eight. Details are editable suggestions.</p>
      </div>
    </header>
    <div className="shopify-purchase-list">
      {purchases.map((purchase) => {
        const key = purchaseKey(purchase);
        const image = images[key];
        const isSelected = selected.includes(key);
        return <article className={`shopify-purchase-card${isSelected ? " selected" : ""}`} key={key}>
          <div
            className="shopify-purchase-image"
            role="img"
            aria-label={`${purchase.title} purchase image`}
            style={image?.status === "ready" ? { backgroundImage: `url(${image.objectUrl})` } : undefined}
          >
            {image?.status === "loading" || !image ? <span>Loading…</span> : null}
            {image?.status === "error" ? <span>Image unavailable</span> : null}
          </div>
          <div className="shopify-purchase-copy">
            <h2>{purchase.title}</h2>
            <p>{purchase.productType ? `${purchase.productType} suggestion` : "Category will be suggested by YiYi"}</p>
            <p>{purchase.tags.length > 0 ? purchase.tags.join(" · ") : "No Shopify tags"}</p>
            <small>{purchase.orderName} · {purchaseDate(purchase.purchasedAt)}</small>
          </div>
          {image?.status === "ready" ? <button
            type="button"
            className="shopify-purchase-select"
            aria-label={`${isSelected ? "Deselect" : "Select"} ${purchase.title}`}
            aria-pressed={isSelected}
            onClick={() => toggle(purchase)}
            disabled={!isSelected && selected.length >= MAX_SELECTED}
          >{isSelected ? <Check size={16} /> : null}</button> : null}
          {image?.status === "error" && image.retryable ? <button
            type="button"
            className="shopify-purchase-retry"
            aria-label={`Retry ${purchase.title} image`}
            onClick={() => void loadImage(purchase, accessToken)}
          ><RefreshCw size={15} />Retry</button> : null}
        </article>;
      })}
    </div>
    <footer className="shopify-import-actions">
      <p>{selected.length} of {MAX_SELECTED} selected</p>
      <PrimaryButton disabled={selected.length === 0} onClick={importSelected}>
        Import {selected.length || "selected"} {selected.length === 1 ? "item" : "items"}
      </PrimaryButton>
    </footer>
  </section>;
}
