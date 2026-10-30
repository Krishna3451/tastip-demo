import {
  applyTripCommand,
  cityRecommendationOperations,
  createTripFromPlaces,
  type Place,
  parseStoredTrip,
  type Trip,
  type TripBrief,
  type TripOperation,
  type TripRoute,
  validRoute,
  visitTravelIssue,
} from "@tastip/domain";

export type TripCandidateGroup = { destinationId: string; places: Place[] };

/** Primary-city rebuild: route/traveler-entered transfers precede all automatic placement. */
export function buildPrimaryTripPreview(
  brief: TripBrief,
  places: Place[],
  route?: TripRoute,
): Trip {
  if (!route) return createTripFromPlaces(brief, places);
  if (!validRoute(route) || route.stays[0]?.destinationId !== brief.destinationId)
    throw new Error("Review the trip's cities, days and dates before building it.");
  const primary = { ...brief, days: route.stays[0].days };
  // All candidates begin as Ideas. There are no accepted/user-chosen visits in this new draft.
  const skeleton = createTripFromPlaces(primary, places, route.startDate, () => false);
  const routed = applyTripCommand(skeleton, {
    id: crypto.randomUUID(),
    baseVersion: skeleton.version,
    operations: [{ type: "set-route", route }],
  });
  if (!routed.ok) throw new Error(routed.error.message);
  let preview = routed.trip;
  const proposal = createTripFromPlaces(
    primary,
    places,
    route.startDate,
    (dayId, time, duration) => !visitTravelIssue(preview, dayId, time, duration),
  );
  if (proposal.stops.length) {
    const scheduled = applyTripCommand(preview, {
      id: crypto.randomUUID(),
      baseVersion: preview.version,
      operations: proposal.stops.map((stop) => ({ type: "add-stop" as const, stop })),
    });
    if (!scheduled.ok) throw new Error(scheduled.error.message);
    preview = scheduled.trip;
  }
  const checked = parseStoredTrip(preview);
  if (!checked)
    throw new Error("The proposed trip could not be validated. Your current trip is unchanged.");
  return checked;
}

/** Prepare a separate, validated draft; accepting it is an explicit planner action. */
export function buildTripPreview(
  brief: TripBrief,
  route: TripRoute,
  groups: TripCandidateGroup[],
): Trip {
  if (!validRoute(route))
    throw new Error("Review the trip's cities, days and dates before building it.");
  const firstStay = route.stays[0];
  if (!firstStay || brief.destinationId !== firstStay.destinationId)
    throw new Error("The first city in your route must match the trip destination.");
  const routeCities = new Set(route.stays.map((stay) => stay.destinationId));
  const groupedCities = new Set<string>();
  for (const group of groups) {
    if (!routeCities.has(group.destinationId))
      throw new Error("These recommendations belong to a city outside the reviewed route.");
    if (groupedCities.has(group.destinationId))
      throw new Error("Use one recommendation group per city so its query order stays intact.");
    groupedCities.add(group.destinationId);
    if (!Array.isArray(group.places))
      throw new Error("A city recommendation list could not be read.");
    const queries = new Set<string>();
    for (const place of group.places) {
      if (place.source !== "qloo" || !place.taste || !place.taste.queryId)
        throw new Error(
          "Only Qloo candidates with their original recommendation evidence can build this draft.",
        );
      if (place.destinationId !== undefined && place.destinationId !== group.destinationId)
        throw new Error("A recommendation belongs to a different city than its group.");
      queries.add(place.taste.queryId);
    }
    if (queries.size > 1)
      throw new Error(
        "Keep each city's recommendations from one Qloo query; ranks from separate queries cannot be combined.",
      );
  }

  let preview = createTripFromPlaces({ ...brief, days: firstStay.days }, []);
  function apply(operations: TripOperation[]) {
    const result = applyTripCommand(preview, {
      id: crypto.randomUUID(),
      baseVersion: preview.version,
      operations,
    });
    if (!result.ok) throw new Error(result.error.message);
    preview = result.trip;
  }
  apply([{ type: "set-route", route }]);
  // Each city's rank stays local to its source query. Empty coverage retains blank city days.
  for (const group of groups) {
    if (group.places.length)
      apply(cityRecommendationOperations(preview, group.destinationId, group.places));
  }
  const accepted = parseStoredTrip(preview);
  if (!accepted)
    throw new Error("The proposed trip could not be validated. Your current trip is unchanged.");
  return accepted;
}
