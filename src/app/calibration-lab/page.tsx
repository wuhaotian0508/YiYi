import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CalibrationLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { CalibrationLab } = await import("@/components/calibration/calibration-lab");
  return <CalibrationLab />;
}
