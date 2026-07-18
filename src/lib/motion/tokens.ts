export const calmSpring = {
  type: "spring",
  stiffness: 410,
  damping: 38,
  mass: 0.82,
} as const;

export const quickSpring = {
  type: "spring",
  stiffness: 520,
  damping: 40,
  mass: 0.72,
} as const;

export const sheetSpring = {
  type: "spring",
  stiffness: 430,
  damping: 36,
  mass: 0.86,
} as const;

export function projectMomentum(velocity: number, decelerationRate = 0.995) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}
