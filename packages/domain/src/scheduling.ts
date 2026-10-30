import { listedDraftVisitTime } from "./draft-hours";
import { destinationForDay, stayForDay, transfersForDay, visitTravelIssue } from "./route";
import type { Place, Trip, TripOperation } from "./types";

export function timeMinutes(value: string) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
export function formatTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/** Draft space only: these gaps do not assert travel feasibility or opening hours. */
export function availableVisitTimes(trip: Trip, dayId: string, durationMinutes = 60): string[] {
  const dayIndex = trip.days.findIndex((day) => day.id === dayId);
  if (
    dayIndex < 0 ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > 1440
  )
    return [];
  const previousDay = trip.days[dayIndex - 1];
  const arrival =
    previousDay && destinationForDay(trip, previousDay.id) !== destinationForDay(trip, dayId);
  const window = trip.brief.tasteProfile?.rhythm ?? "balanced";
  const rhythmStart = window === "early" ? 8 * 60 : window === "late" ? 11 * 60 : 9 * 60 + 30;
  const stay = trip.route ? stayForDay(trip.route, dayIndex) : undefined;
  const enteredArrival = transfersForDay(trip, dayId).find(
    (window) => window.transfer.toStayId === stay?.id,
  );
  const start = enteredArrival
    ? Math.max(rhythmStart, timeMinutes(enteredArrival.timing.arrival.time))
    : arrival
      ? 15 * 60
      : rhythmStart;
  const end = window === "early" ? 19 * 60 : window === "late" ? 23 * 60 : 21 * 60;
  const stops = trip.stops.filter((stop) => stop.dayId === dayId);
  const slots: string[] = [];
  for (let minute = start; minute + durationMinutes <= end; minute += 180) {
    if (
      !visitTravelIssue(trip, dayId, formatTime(minute), durationMinutes) &&
      !stops.some(
        (stop) =>
          minute < timeMinutes(stop.startTime) + stop.durationMinutes &&
          minute + durationMinutes > timeMinutes(stop.startTime),
      )
    )
      slots.push(formatTime(minute));
  }
  return slots;
}

/** Keep each query's rank intact; never compare scores across different queries/cities. */
export function cityRecommendationOperations(
  trip: Trip,
  destinationId: string,
  candidates: Place[],
): TripOperation[] {
  const operations: TripOperation[] = [
    { type: "add-candidates", destinationId, places: candidates },
  ];
  const used = new Set(trip.stops.map((stop) => stop.placeId));
  const places = candidates
    .filter((place) => !used.has(place.id))
    .sort((a, b) => (a.taste?.rank ?? Infinity) - (b.taste?.rank ?? Infinity));
  const added: Trip["stops"] = [];
  const latest =
    trip.brief.tasteProfile?.rhythm === "early"
      ? 19 * 60
      : trip.brief.tasteProfile?.rhythm === "late"
        ? 23 * 60
        : 21 * 60;
  const perDay = trip.brief.pace === "slow" ? 2 : trip.brief.pace === "full" ? 4 : 3;
  for (const day of trip.days.filter((day) => destinationForDay(trip, day.id) === destinationId)) {
    const first = availableVisitTimes({ ...trip, stops: [] }, day.id)[0];
    if (!first) continue;
    const existing = trip.stops.filter((stop) => stop.dayId === day.id).length;
    for (const preferred of availableVisitTimes(trip, day.id).slice(
      0,
      Math.max(0, perDay - existing),
    )) {
      let candidate: { place: Place; index: number; startTime: string } | undefined;
      for (const [index, place] of places.entries()) {
        const startTime = listedDraftVisitTime(
          place,
          day.date,
          preferred,
          timeMinutes(first),
          latest,
          (time) =>
            !visitTravelIssue(trip, day.id, time, 60) &&
            ![...trip.stops, ...added].some(
              (stop) =>
                stop.dayId === day.id &&
                timeMinutes(time) < timeMinutes(stop.startTime) + stop.durationMinutes &&
                timeMinutes(time) + 60 > timeMinutes(stop.startTime),
            ),
        );
        if (startTime === null) continue;
        candidate = { place, index, startTime };
        break;
      }
      if (!candidate) continue;
      const { place, startTime, index } = candidate;
      places.splice(index, 1);
      const stop: Trip["stops"][number] = {
        id: crypto.randomUUID(),
        dayId: day.id,
        placeId: place.id,
        startTime,
        durationMinutes: 60,
        ...(place.taste ? { selection: structuredClone(place.taste) } : {}),
        pinned: false,
        timeLocked: false,
      };
      added.push(stop);
      operations.push({
        type: "add-stop",
        stop,
      });
    }
  }
  return operations;
}
