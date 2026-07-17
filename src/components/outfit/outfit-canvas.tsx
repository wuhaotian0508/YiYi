import type { Outfit, WardrobeItem } from "@/domain/schemas";
import { Garment } from "@/components/wardrobe/garment";

const slots = ["outerwear", "top", "bottom", "onePiece", "shoes", "bag", "jewelry", "extraAccessory"] as const;

export function OutfitCanvas({ outfit, wardrobe, onSelect, className = "" }: { outfit: Outfit; wardrobe: WardrobeItem[]; onSelect?: (slot: (typeof slots)[number]) => void; className?: string }) {
  const lookup = new Map(wardrobe.map((item) => [item.id, item]));
  return (
    <div className={`outfit-canvas ${className}`} aria-label="Recommended outfit">
      {slots.map((slot) => {
        const id = outfit.itemIds[slot];
        const item = id ? lookup.get(id) : undefined;
        if (!item) return null;
        return (
          <button key={slot} type="button" className="outfit-piece" data-slot={slot} onClick={() => onSelect?.(slot)} aria-label={`${item.subtype}. Tap to focus.`}>
            <Garment item={item} />
          </button>
        );
      })}
    </div>
  );
}
