"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import { sheetSpring } from "@/lib/motion/tokens";

export function BottomSheet({
  open,
  onClose,
  label,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const dragControls = useDragControls();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            className="sheet-scrim"
            type="button"
            aria-label={`Close ${label}`}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.2, ease: "easeOut" }}
          />
          <motion.section
            className={`bottom-sheet ${className}`}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={reduceMotion ? { opacity: 0 } : { y: "100%", opacity: 0.88 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { y: "100%", opacity: 0.94 }}
            transition={reduceMotion ? { duration: 0.14 } : sheetSpring}
            drag={reduceMotion ? false : "y"}
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.72 }}
            dragMomentum={false}
            dragSnapToOrigin
            onDragEnd={(_, info) => {
              if (info.offset.y > 96 || info.velocity.y > 650) onClose();
            }}
          >
            <button
              type="button"
              className="sheet-drag-region"
              aria-label={`Drag to close ${label}`}
              onPointerDown={(event) => dragControls.start(event)}
            >
              <span className="sheet-handle" />
            </button>
            <div className="sheet-content">{children}</div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
