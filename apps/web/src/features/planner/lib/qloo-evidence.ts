import {
  destinationForDay,
  getDayStops,
  getTripDestination,
  type Place,
  type Trip,
  type TripStop,
} from "@tastip/domain";

export type QlooVisitEvidence = {
  place: Place;
  stop: TripStop;
  /** A visit's original selection must never borrow a later place-level query. */
  evidence: TripStop["selection"];
};

export function qlooDayEvidence(trip: Trip, dayId: string) {
  const day = trip.days.find((item) => item.id === dayId);
  if (!day) return null;
  const destinationId = destinationForDay(trip, day.id);
  const city = getTripDestination(trip, destinationId);
  const visits: QlooVisitEvidence[] = [];
  let sampleVisits = 0;
  let travelerVisits = 0;
  for (const stop of getDayStops(trip, day.id)) {
    const place = trip.places.find((item) => item.id === stop.placeId);
    if (!place) continue;
    if (place.source === "qloo") visits.push({ place, stop, evidence: stop.selection });
    else if (place.source === "demo") sampleVisits++;
    else if (place.source === "traveler") travelerVisits++;
  }
  const scheduled = new Set(trip.stops.map((stop) => stop.placeId));
  const ideas = trip.places.filter(
    (place) =>
      place.source === "qloo" &&
      (place.destinationId ?? trip.brief.destinationId) === destinationId &&
      !scheduled.has(place.id),
  );
  return {
    day,
    cityName: city?.name ?? destinationId,
    visits,
    ideas,
    sampleVisits,
    travelerVisits,
  };
}
