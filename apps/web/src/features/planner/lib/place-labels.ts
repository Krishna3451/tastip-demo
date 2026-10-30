import type { Place, Trip } from "@tastip/domain";

export function placeSourceLabel(place: Pick<Place, "source">): string {
  if (place.source === "traveler") return "Traveler-added pin · location unverified";
  return place.source === "qloo" ? "Qloo recommendation" : "Fictional sample venue";
}
export function tripSourceLabel(trip: Trip): string {
  const sources = new Set(trip.places.map((place) => place.source));
  if (!sources.size) return "Travel draft";
  if (sources.has("demo")) return sources.size > 1 ? "Mixed draft" : "Sample draft";
  if (sources.size > 1) return "Travel draft";
  return sources.has("qloo") ? "Qloo draft" : "Traveler draft";
}
