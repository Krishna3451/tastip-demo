import { getTripDestination } from "./destinations";
import type { Trip } from "./types";

export function validTripTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 120 &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}
export function getTripRouteTitle(trip: Trip): string {
  const ids = trip.route?.stays.map((stay) => stay.destinationId) ?? [trip.brief.destinationId];
  return ids.map((id) => getTripDestination(trip, id)?.name ?? id).join(" → ");
}
export function getTripTitle(trip: Trip): string {
  return trip.title ?? getTripRouteTitle(trip);
}
