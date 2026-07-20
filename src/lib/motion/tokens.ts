export const motionDuration = {
  press: 0.09,
  short: 0.18,
  standard: 0.24,
  readingCrossfade: 0.32,
} as const;

export const motionEase = {
  standard: [0.22, 1, 0.36, 1],
  exit: [0.4, 0, 1, 1],
} as const;

export const calmSpring = {
  type: "spring",
  stiffness: 360,
  damping: 38,
  mass: 0.9,
} as const;

export const quickSpring = {
  type: "spring",
  stiffness: 510,
  damping: 42,
  mass: 0.74,
} as const;

export const replacementSpring = {
  type: "spring",
  stiffness: 420,
  damping: 40,
  mass: 0.82,
} as const;

export const sheetSpring = {
  type: "spring",
  stiffness: 390,
  damping: 39,
  mass: 0.9,
} as const;
