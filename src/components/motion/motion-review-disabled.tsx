// The development review route is intentionally replaced at production build
// time so review controls and instrumentation never enter deployable chunks.
export function MotionReviewClient() {
  return null;
}
