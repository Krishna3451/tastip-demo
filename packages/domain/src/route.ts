import { getTripDestination, validDestination } from "./destinations";
import { DESTINATIONS } from "./fixtures";
import { MAX_CITY_STAYS, MAX_TRIP_DAYS } from "./limits";
import { localTimeEpoch } from "./time";
import type { CityStay, DomainIssue, Trip, TripRoute } from "./types";

export function isLocalDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** Calendar arithmetic uses UTC only as a date container, never the browser's timezone. */
export function dateAt(start: string, offset: number): string {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function validRoute(value: unknown): value is TripRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as TripRoute;
  if (
    (route.startDate !== null && !isLocalDate(route.startDate)) ||
    !Array.isArray(route.stays) ||
    route.stays.length < 1 ||
    route.stays.length > MAX_CITY_STAYS ||
    !Array.isArray(route.transfers)
  )
    return false;
  const ids = new Set<string>();
  for (const stay of route.stays) {
    if (
      !stay ||
      typeof stay.id !== "string" ||
      !stay.id.trim() ||
      ids.has(stay.id) ||
      (stay.destination !== undefined &&
        (!validDestination(stay.destination) || stay.destination.id !== stay.destinationId)) ||
      !(
        DESTINATIONS.some((city) => city.id === stay.destinationId) ||
        (validDestination(stay.destination) && stay.destination.id === stay.destinationId)
      ) ||
      !Number.isInteger(stay.days) ||
      stay.days < 1 ||
      stay.days > MAX_TRIP_DAYS
    )
      return false;
    ids.add(stay.id);
  }
  if (
    route.stays.reduce((sum, stay) => sum + stay.days, 0) > MAX_TRIP_DAYS ||
    route.transfers.length !== route.stays.length - 1
  )
    return false;
  const transferIds = new Set<string>();
  for (let index = 0; index < route.transfers.length; index++) {
    const transfer = route.transfers[index];
    if (
      !transfer ||
      typeof transfer.id !== "string" ||
      !transfer.id.trim() ||
      transferIds.has(transfer.id) ||
      transfer.fromStayId !== route.stays[index]?.id ||
      transfer.toStayId !== route.stays[index + 1]?.id ||
      !["undecided", "train", "flight", "car", "bus"].includes(transfer.mode)
    )
      return false;
    transferIds.add(transfer.id);
    if (transfer.timing !== undefined) {
      const window = transferWindow(route, index);
      const dates = routeStayDates(route);
      const fromDates = dates[index];
      const toDates = dates[index + 1];
      if (
        !window ||
        !fromDates?.arrival ||
        !fromDates.departure ||
        !toDates ||
        transfer.timing.source !== "traveler" ||
        transfer.timing.departure.date < fromDates.arrival ||
        transfer.timing.departure.date > fromDates.departure ||
        transfer.timing.arrival.date !== toDates.arrival ||
        window.arrivalEpoch <= window.departureEpoch
      )
        return false;
      const previous = index > 0 ? transferWindow(route, index - 1) : null;
      if (previous && window.departureEpoch < previous.arrivalEpoch) return false;
    }
  }
  // Protect date overflow near the upper limit of the ISO calendar.
  return (
    route.startDate === null ||
    dateAt(route.startDate, route.stays.reduce((sum, stay) => sum + stay.days, 0) - 1).length === 10
  );
}

export function routeDayDate(route: TripRoute, index: number): string | null {
  return route.startDate === null ? null : dateAt(route.startDate, index);
}

export function transferWindow(route: TripRoute, index: number) {
  const transfer = route.transfers[index];
  const timing = transfer?.timing;
  const fromStay = route.stays[index];
  const toStay = route.stays[index + 1];
  const from =
    fromStay?.destination ?? DESTINATIONS.find((city) => city.id === fromStay?.destinationId);
  const to = toStay?.destination ?? DESTINATIONS.find((city) => city.id === toStay?.destinationId);
  if (!transfer || !timing || !from || !to) return null;
  try {
    return {
      transfer,
      timing,
      from,
      to,
      departureEpoch: localTimeEpoch(timing.departure, from.timeZone),
      arrivalEpoch: localTimeEpoch(timing.arrival, to.timeZone),
    };
  } catch {
    return null;
  }
}

/** Display the relevant travel window on each affected city day, including overnight travel. */
export function transfersForDay(trip: Trip, dayId: string) {
  const route = trip.route;
  const dayIndex = trip.days.findIndex((day) => day.id === dayId);
  const day = trip.days[dayIndex];
  if (!route || !day?.date) return [];
  const date = day.date;
  const stay = stayForDay(route, dayIndex);
  return route.transfers.flatMap((transfer, index) => {
    const window = transferWindow(route, index);
    if (!window) return [];
    const outgoing = transfer.fromStayId === stay?.id && date >= window.timing.departure.date;
    const incoming = transfer.toStayId === stay?.id && date === window.timing.arrival.date;
    return outgoing || incoming ? [window] : [];
  });
}

/** Shared by accepted edits and recommendation placement; no travel feasibility is inferred. */
export function visitTravelIssue(
  trip: Trip,
  dayId: string,
  startTime: string,
  durationMinutes: number,
): DomainIssue | null {
  const route = trip.route;
  if (!route?.transfers.some((transfer) => transfer.timing)) return null;
  const index = trip.days.findIndex((day) => day.id === dayId);
  const day = trip.days[index];
  const stay = stayForDay(route, index);
  const city = stay && getTripDestination(trip, stay.destinationId);
  if (!day?.date || !stay || !city) return null;
  try {
    const start = localTimeEpoch({ date: day.date, time: startTime }, city.timeZone);
    const end = start + durationMinutes * 60_000;
    for (const [transferIndex, transfer] of route.transfers.entries()) {
      const window = transferWindow(route, transferIndex);
      if (!window) continue;
      if (
        (transfer.fromStayId === stay.id && end > window.departureEpoch) ||
        (transfer.toStayId === stay.id && start < window.arrivalEpoch)
      )
        return {
          code: "TRANSFER_CONFLICT",
          message:
            "This visit conflicts with your entered travel times. Schedule it after arrival and before departure, or change the transfer times.",
        };
    }
    return null;
  } catch (error) {
    return {
      code: "INVALID_LOCAL_TIME",
      message: error instanceof Error ? error.message : "Check this visit's local time.",
    };
  }
}

export function stayForDay(route: TripRoute, index: number): CityStay | undefined {
  let offset = 0;
  for (const stay of route.stays) {
    if (index >= offset && index < offset + stay.days) return stay;
    offset += stay.days;
  }
  return undefined;
}

export function destinationForDay(trip: Trip, dayId: string): string {
  const index = trip.days.findIndex((day) => day.id === dayId);
  return trip.route
    ? (stayForDay(trip.route, index)?.destinationId ?? trip.brief.destinationId)
    : trip.brief.destinationId;
}

export function routeStayDates(route: TripRoute) {
  let offset = 0;
  return route.stays.map((stay, index) => {
    const firstDay = offset;
    offset += stay.days;
    const nights = stay.days - (index === route.stays.length - 1 ? 1 : 0);
    return {
      ...stay,
      firstDay,
      arrival: routeDayDate(route, firstDay),
      departure: routeDayDate(route, firstDay + nights),
      nights,
    };
  });
}
