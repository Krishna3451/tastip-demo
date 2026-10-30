import {
  DEFAULT_BRIEF,
  DESTINATIONS,
  type Destination,
  type Place,
  parseStoredTrip,
  validDestination,
} from "@tastip/domain";

export type SavedPlaceRecord = { place: Place; destination: Destination };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Restore saved records with the same source/facts rules as accepted trip storage. */
export function parseSavedPlaceRecord(value: unknown): SavedPlaceRecord | null {
  if (!record(value)) return null;
  const wrapped = "place" in value;
  const candidate = wrapped ? value.place : value;
  if (!record(candidate)) return null;
  const suppliedDestination = wrapped ? value.destination : undefined;
  if (suppliedDestination !== undefined && !validDestination(suppliedDestination)) return null;
  const destination =
    suppliedDestination ?? DESTINATIONS.find((city) => city.id === candidate.destinationId);
  if (!validDestination(destination)) return null;
  if (candidate.destinationId !== undefined && candidate.destinationId !== destination.id)
    return null;

  // This fixed envelope is only a validator; no trip, visit or generated facts are saved.
  // The recommendation composer rejects traveler pins and must not validate Saved records.
  const checked = parseStoredTrip({
    id: "saved-place-validation",
    version: 1,
    brief: { ...DEFAULT_BRIEF, destinationId: destination.id, destination, days: 1 },
    places: [candidate],
    days: [{ id: "saved-place-validation-day", label: "Saved place validation", date: null }],
    stops: [],
    appliedCommandIds: [],
    commandLog: [],
    updatedAt: "1970-01-01T00:00:00.000Z",
  });
  const place = checked?.places[0];
  if (!place) return null;
  return {
    place: { ...place, destinationId: destination.id },
    destination: {
      id: destination.id,
      name: destination.name,
      country: destination.country,
      lat: destination.lat,
      lng: destination.lng,
      timeZone: destination.timeZone,
    },
  };
}

/** Reject a damaged cache as a whole; callers must keep its stored copy and block writes. */
export function parseSavedPlaces(raw: string): SavedPlaceRecord[] | null {
  if (raw.length > 4_000_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 100) return null;
    const accepted: SavedPlaceRecord[] = [];
    const ids = new Set<string>();
    for (const item of value) {
      const parsed = parseSavedPlaceRecord(item);
      if (!parsed || ids.has(parsed.place.id)) return null;
      ids.add(parsed.place.id);
      accepted.push(parsed);
    }
    return accepted;
  } catch {
    return null;
  }
}
