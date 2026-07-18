"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue, type PanInfo } from "motion/react";
import type { Outfit, WardrobeItem } from "@/domain/schemas";
import { calmSpring, projectMomentum } from "@/lib/motion/tokens";
import { OutfitCanvas } from "@/components/outfit/outfit-canvas";

const GAP = 10;
const SLIDE_RATIO = 0.9;

function CarouselSlide({
  outfit,
  wardrobe,
  x,
  snapPoint,
  step,
  active,
  onSelectItem,
  onSelectOutfit,
}: {
  outfit: Outfit;
  wardrobe: WardrobeItem[];
  x: MotionValue<number>;
  snapPoint: number;
  step: number;
  active: boolean;
  onSelectItem?: (slot: keyof Outfit["itemIds"]) => void;
  onSelectOutfit: () => void;
}) {
  const scale = useTransform(x, [snapPoint - step, snapPoint, snapPoint + step], [0.94, 1, 0.94]);
  const opacity = useTransform(x, [snapPoint - step, snapPoint, snapPoint + step], [0.48, 1, 0.48]);

  return (
    <motion.div
      className="outfit-carousel-slide"
      style={{ scale, opacity }}
      aria-hidden={!active}
      onClick={active ? undefined : onSelectOutfit}
    >
      <OutfitCanvas outfit={outfit} wardrobe={wardrobe} onSelect={active ? onSelectItem : undefined} />
    </motion.div>
  );
}

export function OutfitCarousel({
  outfits,
  wardrobe,
  selectedIndex,
  onSelect,
  onSelectItem,
}: {
  outfits: Outfit[];
  wardrobe: WardrobeItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onSelectItem: (slot: keyof Outfit["itemIds"]) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const [width, setWidth] = useState(0);
  const x = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const slideWidth = width * SLIDE_RATIO;
  const step = slideWidth + GAP;
  const inset = (width - slideWidth) / 2;
  const snapPoints = useMemo(() => outfits.map((_, index) => inset - index * step), [inset, outfits, step]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateWidth = () => setWidth(viewport.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = snapPoints[selectedIndex];
    if (target === undefined) return;
    animationRef.current?.stop();
    animationRef.current = animate(x, target, reduceMotion ? { duration: 0.01 } : calmSpring);
    return () => animationRef.current?.stop();
  }, [reduceMotion, selectedIndex, snapPoints, x]);

  function settle(info: PanInfo) {
    if (!snapPoints.length) return;
    const projected = x.get() + projectMomentum(info.velocity.x);
    let targetIndex = 0;
    let smallestDistance = Number.POSITIVE_INFINITY;
    snapPoints.forEach((point, index) => {
      const distance = Math.abs(point - projected);
      if (distance < smallestDistance) {
        targetIndex = index;
        smallestDistance = distance;
      }
    });
    const target = snapPoints[targetIndex];
    animationRef.current?.stop();
    animationRef.current = animate(x, target, reduceMotion ? { duration: 0.01 } : { ...calmSpring, velocity: info.velocity.x });
    if (targetIndex !== selectedIndex) onSelect(targetIndex);
  }

  return (
    <div ref={viewportRef} className="outfit-carousel" aria-roledescription="carousel" aria-label="Outfit recommendations">
      <motion.div
        className="outfit-carousel-track"
        style={{ x, gap: GAP, visibility: width ? "visible" : "hidden" }}
        drag={reduceMotion || outfits.length < 2 ? false : "x"}
        dragConstraints={{ left: snapPoints.at(-1) ?? 0, right: snapPoints[0] ?? 0 }}
        dragElastic={0.16}
        dragMomentum={false}
        onDragStart={() => animationRef.current?.stop()}
        onDragEnd={(_, info) => settle(info)}
      >
        {outfits.map((outfit, index) => (
          <div className="outfit-carousel-slide-frame" style={{ width: slideWidth }} key={outfit.id}>
            <CarouselSlide
              outfit={outfit}
              wardrobe={wardrobe}
              x={x}
              snapPoint={snapPoints[index] ?? 0}
              step={Math.max(step, 1)}
              active={index === selectedIndex}
              onSelectItem={onSelectItem}
              onSelectOutfit={() => onSelect(index)}
            />
          </div>
        ))}
      </motion.div>
    </div>
  );
}
