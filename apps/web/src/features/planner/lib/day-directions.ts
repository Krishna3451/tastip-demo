import {
  destinationForDay,
  getDayStops,
  getTripDestination,
  localTimeEpoch,
  type Place,
  type Trip,
} from "@tastip/domain";
import type { DrivingRoute } from "@tastip/providers";
import { placeMapUrl } from "./travel-pack";

export type DirectionsMode = "walking" | "transit" | "driving";

/** This launches a separate Maps search; it supplies no route, duration or reservation to Tastip. */
export function betweenPlacesUrl(
  from: Pick<Place, "lat" | "lng">,
  to: Pick<Place, "lat" | "lng">,
  mode: DirectionsMode,
): string {
  placeMapUrl(from.lat, from.lng);
  placeMapUrl(to.lat, to.lng);
  if (!["walking", "transit", "driving"].includes(mode))
    throw new Error("Choose a supported directions mode.");
  const url = new URL("https://www.google.com/maps/dir/");
  url.search = new URLSearchParams({
    api: "1",
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    travelmode: mode,
  }).toString();
  return url.toString();
}

export function realDayVisits(trip: Trip, dayId: string) {
  return getDayStops(trip, dayId).flatMap((stop) => {
    const place = trip.places.find((item) => item.id === stop.placeId);
    return place && place.source !== "demo" ? [{ stopId: stop.id, place }] : [];
  });
}

/** Match route legs by visit identity, never by indices into a differently filtered list. */
export function drivingRouteConflicts(
  trip: Trip,
  dayId: string,
  route: Pick<DrivingRoute, "legs">,
): string[] {
  const stops = getDayStops(trip, dayId);
  const places = realDayVisits(trip, dayId);
  const day = trip.days.find((item) => item.id === dayId);
  const city = getTripDestination(trip, destinationForDay(trip, dayId));
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return route.legs.flatMap((leg, index) => {
    const from = places[index];
    const to = places[index + 1];
    if (!from || !to) return [];
    const fromIndex = stops.findIndex((stop) => stop.id === from.stopId);
    const current = stops[fromIndex];
    const next = stops[fromIndex + 1];
    // Omitted sample stops have no real-world location; do not infer feasibility across them.
    if (!current || next?.id !== to.stopId) return [];
    let gap = minutes(next.startTime) - minutes(current.startTime) - current.durationMinutes;
    if (day?.date && city) {
      try {
        gap =
          (localTimeEpoch({ date: day.date, time: next.startTime }, city.timeZone) -
            localTimeEpoch({ date: day.date, time: current.startTime }, city.timeZone)) /
            60_000 -
          current.durationMinutes;
      } catch {
        return [];
      }
    }
    const duration = Math.ceil(leg.durationSeconds / 60);
    return gap < duration
      ? [
          `Allow more time between ${from.place.name} and ${to.place.name}: your gap is ${gap} minutes; this driving estimate is ${duration} minutes.`,
        ]
      : [];
  });
}
