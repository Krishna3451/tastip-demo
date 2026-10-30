import type { Trip } from "@tastip/domain";
import { projectTripContext, projectTripContextInput } from "@tastip/providers/context";

/** Send the current view of the plan, never the growing undo/history snapshots. */
export function tripRequestContext(trip: Trip | null | undefined) {
  if (!trip) return undefined;
  return projectTripContextInput({
    id: trip.id,
    version: trip.version,
    brief: trip.brief,
    days: trip.days.map(({ id, label, date }) => ({ id, label, date })),
    route: trip.route,
    lodgings: trip.lodgings?.map((choice) => ({
      stayId: choice.stayId,
      name: choice.candidate.name,
      destinationId: choice.candidate.destinationId,
    })),
    places: trip.places.map(({ id, name, source }) => ({ id, name, source })),
    stops: trip.stops.map(
      ({ id, placeId, dayId, startTime, durationMinutes, pinned, timeLocked }) => ({
        id,
        placeId,
        dayId,
        startTime,
        durationMinutes,
        pinned,
        timeLocked,
      }),
    ),
  });
}

/** Same bounded provider DTO used at session issuance and during live updates. */
export function tripProviderContext(trip: Trip | null | undefined) {
  return projectTripContext(tripRequestContext(trip));
}
