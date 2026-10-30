import {
  briefDestination,
  type TasteProfile,
  type TripBrief,
  type TripRoute,
} from "@tastip/domain";
import { buildTripPreview } from "./trip-generation";

/** Snapshot entry choices for the shared city-by-city preview, never an accepted trip. */
export function entryTripReview(brief: TripBrief, profile: TasteProfile, route?: TripRoute) {
  const destination = briefDestination(brief);
  if (!destination) throw new Error("Review your destination before finding places.");
  const snapshot = structuredClone({
    brief: { ...brief, tasteProfile: profile },
    route: route ?? {
      startDate: null,
      stays: [{ id: "stay-1", destinationId: destination.id, destination, days: brief.days }],
      transfers: [],
    },
  });
  // Reuse the same domain validation as chat creation, including dates and travel windows.
  const checked = buildTripPreview(snapshot.brief, snapshot.route, []);
  return { brief: checked.brief, route: snapshot.route };
}
