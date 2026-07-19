"use client";

import { useEffect, useRef } from "react";
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
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const firstControl = sheetRef.current?.querySelector<HTMLElement>(".sheet-content button:not(:disabled), .sheet-content input:not(:disabled), .sheet-content select:not(:disabled), .sheet-content textarea:not(:disabled), .sheet-content a[href]");
      (firstControl ?? sheetRef.current)?.focus({ preventScroll: true });
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const controls = [...sheetRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])")];
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
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
            ref={sheetRef}
            className={`bottom-sheet ${className}`}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
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
              aria-label={`${reduceMotion ? "Close" : "Drag to close"} ${label}`}
              onClick={reduceMotion ? onClose : undefined}
              onPointerDown={reduceMotion ? undefined : (event) => dragControls.start(event)}
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
