"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useLiveQuery } from "dexie-react-hooks";
import { colorHex } from "@/domain/taxonomy";
import type { WardrobeItem } from "@/domain/schemas";
import { getItemImageSet } from "@/lib/storage/db";

const spriteIndexById: Record<string, number> = {
  "11111111-1111-4111-8111-111111111111": 0,
  "11111111-1111-4111-8111-111111111112": 0,
  "11111111-1111-4111-8111-111111111113": 2,
  "22222222-2222-4222-8222-222222222221": 1,
  "22222222-2222-4222-8222-222222222222": 1,
  "22222222-2222-4222-8222-222222222223": 3,
  "33333333-3333-4333-8333-333333333331": 4,
  "33333333-3333-4333-8333-333333333332": 5,
  "33333333-3333-4333-8333-333333333333": 6,
  "44444444-4444-4444-8444-444444444441": 8,
  "44444444-4444-4444-8444-444444444442": 9,
  "55555555-5555-4555-8555-555555555551": 10,
  "55555555-5555-4555-8555-555555555552": 11,
  "66666666-6666-4666-8666-666666666661": 12,
  "66666666-6666-4666-8666-666666666662": 13,
  "77777777-7777-4777-8777-777777777771": 14,
  "77777777-7777-4777-8777-777777777772": 15,
};

const cleanDemoAssetById: Partial<Record<string, string>> = {
  "44444444-4444-4444-8444-444444444441": "/demo-wardrobe/white-sneakers-clean.webp",
};

export function Garment({ item, className = "" }: { item: WardrobeItem; className?: string }) {
  const imageSet = useLiveQuery(() => getItemImageSet(item.id), [item.id]);
  const [localSource, setLocalSource] = useState<string | null>(null);
  useEffect(() => {
    if (!imageSet?.thumbnailBlob) return;
    const source = URL.createObjectURL(imageSet.thumbnailBlob);
    const frame = window.requestAnimationFrame(() => setLocalSource(source));
    return () => { window.cancelAnimationFrame(frame); URL.revokeObjectURL(source); };
  }, [imageSet]);
  if (localSource) return <span aria-hidden="true" className={`garment-local ${className}`}><Image unoptimized alt="" src={localSource} fill sizes="126px" /></span>;
  const cleanDemoAsset = cleanDemoAssetById[item.id];
  if (cleanDemoAsset) return <span aria-hidden="true" className={`garment-demo-asset ${className}`}><Image alt="" src={cleanDemoAsset} fill sizes="126px" /></span>;
  const spriteIndex = spriteIndexById[item.id];
  const shapeCategory = ["top", "outerwear", "bottom", "shoes", "bag", "jewelry", "headwear", "eyewear", "one_piece"].includes(item.category) ? item.category : "jewelry";
  if (spriteIndex !== undefined) {
    const column = spriteIndex % 4;
    const row = Math.floor(spriteIndex / 4);
    return <div aria-hidden="true" className={`garment-photo ${shapeCategory} ${className}`} style={{ "--sprite-x": `${column * 33.333}%`, "--sprite-y": `${row * 33.333}%` } as React.CSSProperties} />;
  }
  return <div aria-hidden="true" className={`garment ${shapeCategory} ${className}`} style={{ "--garment": colorHex[item.primaryColor] } as React.CSSProperties} />;
}
