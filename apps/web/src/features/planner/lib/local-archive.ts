import { parseStoredTrip, type Trip } from "@tastip/domain";

/** Keep a recoverable copy before leaving or rebuilding a local draft. */
export function archiveBeforeLeaving(
  storage: Pick<Storage, "getItem" | "setItem">,
  trip: Trip,
  key = "tastip.library.v1",
) {
  if (!parseStoredTrip(trip))
    throw new Error("This draft could not be validated. Download a backup before leaving.");
  const stored: unknown = JSON.parse(storage.getItem(key) ?? "[]");
  if (!Array.isArray(stored))
    throw new Error("Saved trips could not be read. Download a backup before leaving.");
  const trips = stored.map(parseStoredTrip).filter((item): item is Trip => Boolean(item));
  const others = trips.filter((item) => item.id !== trip.id);
  if (others.length >= 12)
    throw new Error(
      "Your saved trips are full. Download a backup or remove a saved trip before leaving.",
    );
  storage.setItem(key, JSON.stringify([trip, ...others]));
}
