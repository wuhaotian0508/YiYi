import type { Outfit, WardrobeItem } from "@/domain/schemas";
import { db } from "@/lib/storage/db";

const spriteIndexById: Record<string, number> = {
  "11111111-1111-4111-8111-111111111111": 0,
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

const anchors: Record<keyof Outfit["itemIds"], { x: number; y: number; size: number }> = {
  outerwear: { x: 24, y: 54, size: 190 },
  top: { x: 170, y: 42, size: 180 },
  bottom: { x: 170, y: 238, size: 190 },
  onePiece: { x: 146, y: 116, size: 220 },
  shoes: { x: 34, y: 414, size: 180 },
  bag: { x: 322, y: 234, size: 150 },
  jewelry: { x: 350, y: 58, size: 110 },
  extraAccessory: { x: 340, y: 430, size: 120 },
};

function loadImage(source: string | Blob) {
  return new Promise<{ image: HTMLImageElement; revoke?: () => void }>((resolve, reject) => {
    const image = new Image();
    const url = source instanceof Blob ? URL.createObjectURL(source) : source;
    image.onload = () => resolve({ image, revoke: source instanceof Blob ? () => URL.revokeObjectURL(url) : undefined });
    image.onerror = () => { if (source instanceof Blob) URL.revokeObjectURL(url); reject(new Error("Candidate image could not be loaded")); };
    image.src = url;
  });
}

export async function renderCandidateBoard(outfit: Outfit, wardrobe: WardrobeItem[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 640;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const lookup = new Map(wardrobe.map((item) => [item.id, item]));
  const sprite = await loadImage("/demo-wardrobe/wardrobe-sprite.webp");
  try {
    for (const [slot, id] of Object.entries(outfit.itemIds) as [keyof Outfit["itemIds"], string | undefined][]) {
      if (!id || !lookup.has(id)) continue;
      const anchor = anchors[slot];
      const localImage = await db.itemImages.get(id);
      if (localImage?.cutoutBlob) {
        const loaded = await loadImage(localImage.cutoutBlob);
        context.drawImage(loaded.image, anchor.x, anchor.y, anchor.size, anchor.size);
        loaded.revoke?.();
        continue;
      }
      const index = spriteIndexById[id];
      if (index === undefined) continue;
      const cellWidth = sprite.image.naturalWidth / 4;
      const cellHeight = sprite.image.naturalHeight / 4;
      context.drawImage(
        sprite.image,
        (index % 4) * cellWidth,
        Math.floor(index / 4) * cellHeight,
        cellWidth,
        cellHeight,
        anchor.x,
        anchor.y,
        anchor.size,
        anchor.size,
      );
    }
  } finally {
    sprite.revoke?.();
  }
  const attempts = [0.74, 0.62, 0.5];
  for (const quality of attempts) {
    const dataUrl = canvas.toDataURL("image/webp", quality);
    const bytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
    if (bytes <= 240_000) return { dataUrl, bytes, width: canvas.width, height: canvas.height };
  }
  const compact = document.createElement("canvas");
  compact.width = 384;
  compact.height = 480;
  const compactContext = compact.getContext("2d");
  if (!compactContext) throw new Error("BOARD_TOO_LARGE");
  compactContext.drawImage(canvas, 0, 0, compact.width, compact.height);
  const dataUrl = compact.toDataURL("image/webp", 0.52);
  const bytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
  if (bytes > 240_000) throw new Error("BOARD_TOO_LARGE");
  return { dataUrl, bytes, width: compact.width, height: compact.height };
}
