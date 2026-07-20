import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MotionReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { MotionReviewClient } = await import("@/components/motion/motion-review-client");
  return <MotionReviewClient />;
}
