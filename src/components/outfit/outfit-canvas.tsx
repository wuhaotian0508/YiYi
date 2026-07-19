"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Outfit, WardrobeItem } from "@/domain/schemas";
import { Garment } from "@/components/wardrobe/garment";
import { quickSpring } from "@/lib/motion/tokens";

const slots = ["outerwear", "top", "bottom", "onePiece", "shoes", "bag", "jewelry", "extraAccessory"] as const;

export function OutfitCanvas({ outfit, wardrobe, onSelect, className = "", visibleSlots }: { outfit: Outfit; wardrobe: WardrobeItem[]; onSelect?: (slot: (typeof slots)[number]) => void; className?: string; visibleSlots?: readonly (typeof slots)[number][] }) {
  const reduceMotion = useReducedMotion();
  const lookup = new Map(wardrobe.map((item) => [item.id, item]));
  return (
    <div className={`outfit-canvas ${className}`} aria-label="Recommended outfit">
      {slots.map((slot) => {
        if (visibleSlots && !visibleSlots.includes(slot)) return null;
        const id = outfit.itemIds[slot];
        const item = id ? lookup.get(id) : undefined;
        if (!item) return null;
        const visual = (
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                className="outfit-item-visual"
                key={item.id}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -3 }}
                transition={reduceMotion ? { duration: 0.12 } : quickSpring}
              >
                <Garment item={item} />
              </motion.span>
            </AnimatePresence>
        );
        if (!onSelect) return <motion.div key={slot} className="outfit-piece" data-slot={slot} data-category={item.category}>{visual}</motion.div>;
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
