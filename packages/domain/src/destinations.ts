import { DESTINATIONS } from "./fixtures";
import type { Destination, Trip, TripBrief } from "./types";

export function validDestination(value: unknown): value is Destination {
  if (!value || typeof value !== "object") return false;
  const city = value as Destination;
  if (
    ![city.id, city.name, city.country, city.timeZone].every(
      (item) => typeof item === "string" && item.trim().length > 0 && item.length <= 150,
    ) ||
    !Number.isFinite(city.lat) ||
    Math.abs(city.lat) > 90 ||
    !Number.isFinite(city.lng) ||
    Math.abs(city.lng) > 180
  )
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: city.timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
export function briefDestination(brief: TripBrief): Destination | undefined {
  return brief.destination?.id === brief.destinationId && validDestination(brief.destination)
    ? brief.destination
    : DESTINATIONS.find((city) => city.id === brief.destinationId);
}
export function getTripDestination(trip: Trip, id: string): Destination | undefined {
  if (trip.brief.destinationId === id) return briefDestination(trip.brief);
  const embedded = trip.route?.stays.find((stay) => stay.destinationId === id)?.destination;
  return embedded && embedded.id === id && validDestination(embedded)
    ? embedded
    : DESTINATIONS.find((city) => city.id === id);
}
