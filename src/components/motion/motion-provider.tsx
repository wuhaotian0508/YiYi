"use client";

import { MotionConfig } from "motion/react";

export function YiYiMotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
