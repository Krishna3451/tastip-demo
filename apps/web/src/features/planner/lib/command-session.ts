import {
  applyTripCommand,
  type CommandResult,
  type Trip,
  type TripOperation,
} from "@tastip/domain";

/** Serialize accepted UI/async edits before React's next render, preventing lost updates. */
export function acceptLocalCommand(
  session: { current: Trip | null },
  operations: TripOperation[],
  expectedVersion?: number,
  expectedTripId?: string,
  commandId = crypto.randomUUID(),
): CommandResult {
  const trip = session.current;
  if (!trip)
    return {
      ok: false,
      error: { code: "NO_TRIP", message: "Open a trip before applying an edit." },
    };
  if (expectedTripId !== undefined && expectedTripId !== trip.id)
    return {
      ok: false,
      error: {
        code: "STALE_TRIP",
        message: "This suggestion belongs to an older trip. Prepare a fresh suggestion.",
      },
    };
  const result = applyTripCommand(trip, {
    id: commandId,
    baseVersion: expectedVersion ?? trip.version,
    operations,
  });
  if (result.ok) session.current = result.trip;
  return result;
}
