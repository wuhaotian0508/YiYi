"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import type { Outfit, WardrobeItem } from "@/domain/schemas";
import { Garment } from "@/components/wardrobe/garment";
import { motionDuration, motionEase } from "@/lib/motion/tokens";

const slots = ["outerwear", "top", "bottom", "onePiece", "shoes", "bag", "jewelry", "extraAccessory"] as const;

export function OutfitCanvas({ outfit, wardrobe, onSelect, className = "", visibleSlots }: { outfit: Outfit; wardrobe: WardrobeItem[]; onSelect?: (slot: (typeof slots)[number]) => void; className?: string; visibleSlots?: readonly (typeof slots)[number][] }) {
  const reduceMotion = useReducedMotionConfig();
  const lookup = new Map(wardrobe.map((item) => [item.id, item]));
  return (
    <div className={`outfit-canvas ${className}`} aria-label="Recommended outfit">
      {slots.map((slot) => {
        if (visibleSlots && !visibleSlots.includes(slot)) return null;
        const id = outfit.itemIds[slot];
        const item = id ? lookup.get(id) : undefined;
        if (!item) return null;
        const itemVisual = <span className="outfit-item-visual" data-item-id={item.id}><Garment item={item} /></span>;
        const visual = reduceMotion ? itemVisual : (
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                className="outfit-item-visual"
                key={item.id}
                data-item-id={item.id}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: motionDuration.standard, ease: motionEase.standard }}
              >
                <Garment item={item} />
              </motion.span>
            </AnimatePresence>
        );
        if (!onSelect) return <div key={slot} className="outfit-piece" data-slot={slot} data-category={item.category}>{visual}</div>;
        return (
          <motion.button
            key={slot}
            type="button"
            className="outfit-piece"
            data-slot={slot}
            data-category={item.category}
            onClick={() => onSelect(slot)}
            aria-label={`${item.subtype}. Tap to focus.`}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
          >
            {visual}
          </motion.button>
        );
      })}
    </div>
  );
}
