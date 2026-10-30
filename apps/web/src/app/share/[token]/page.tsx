import type { Trip } from "@tastip/domain";
import { notFound } from "next/navigation";
import { ShareTrip } from "@/features/planner/components/share-trip";
import { getTripStore } from "@/server/trip-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shared travel draft · Tastip",
  robots: { index: false, follow: false },
};
export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let trip: Trip;
  try {
    trip = getTripStore().shared(token);
  } catch {
    notFound();
  }
  return <ShareTrip trip={trip} />;
}
