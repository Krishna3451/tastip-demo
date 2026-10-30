import { expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand, validateTrip } from "./trip";

test("private visit notes remain editable on locked visits and survive replay, clearing and undo", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  before.stops[0]!.pinned = true;
  before.stops[0]!.timeLocked = true;
  const command = {
    id: "visit-note",
    baseVersion: 1,
    operations: [
      {
        type: "set-stop-note" as const,
        stopId: before.stops[0]!.id,
        note: "  Ask about the quiet room.\nBring the tickets.  ",
      },
    ],
  };
  const result = applyTripCommand(before, command);
  if (!result.ok) throw new Error(result.error.message);
  expect(before.stops[0]?.note).toBeUndefined();
  expect(result.trip.stops[0]?.note).toBe("Ask about the quiet room.\nBring the tickets.");
  expect(result.trip.stops[0]?.startTime).toBe(before.stops[0]?.startTime);
  expect(result.receipt.affectedStopIds).toEqual([before.stops[0]!.id]);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
  if (!restored) throw new Error("Visit note failed persistence validation");
  const replay = applyTripCommand(restored, command);
  expect(replay.ok && replay.replayed).toBe(true);
  expect(applyTripCommand(restored, { ...command, id: "stale-note" }).ok).toBe(false);
  const cleared = applyTripCommand(restored, {
    id: "clear-note",
    baseVersion: restored.version,
    operations: [{ type: "set-stop-note", stopId: before.stops[0]!.id, note: " " }],
  });
  if (!cleared.ok) throw new Error(cleared.error.message);
  expect(cleared.trip.stops[0]?.note).toBeUndefined();
  const undone = undoTripCommand(cleared.trip, cleared.receipt, "undo-note-clear");
  expect(undone.ok && undone.trip.stops[0]?.note).toBe(restored.stops[0]?.note);
  expect(parseStoredTrip(undone.ok ? undone.trip : null)).not.toBeNull();
});

test("a replaced venue loses the old visit note while undo restores the note and original venue", () => {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  trip.stops[0]!.note = "Old venue reminder";
  const original = trip.stops[0]!;
  const replacement = trip.places.find(
    (place) => !trip.stops.some((stop) => stop.placeId === place.id),
  )!;
  const result = applyTripCommand(trip, {
    id: "replace-noted-visit",
    baseVersion: 1,
    operations: [{ type: "replace-stop", stopId: original.id, placeId: replacement.id }],
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.trip.stops[0]?.note).toBeUndefined();
  expect(result.trip.stops[0]?.placeId).toBe(replacement.id);
  const undone = undoTripCommand(result.trip, result.receipt, "undo-replaced-note");
  expect(undone.ok && undone.trip.stops[0]).toEqual(original);
});

test("invalid notes cannot enter a trip or partially mutate an accepted batch", () => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  const stop = trip.stops[0]!;
  for (const note of [null, 1, "", " ", "x".repeat(2001)]) {
    const malformed = { ...trip, stops: [{ ...stop, note }, ...trip.stops.slice(1)] };
    expect(parseStoredTrip(malformed)).toBeNull();
  }
  expect(
    validateTrip({ ...trip, stops: [{ ...stop, note: "x".repeat(2000) }, ...trip.stops.slice(1)] }),
  ).toEqual([]);
  const result = applyTripCommand(trip, {
    id: "invalid-note-batch",
    baseVersion: 1,
    operations: [
      { type: "pin-stop", stopId: stop.id, pinned: true },
      { type: "set-stop-note", stopId: stop.id, note: "x".repeat(2001) },
    ],
  });
  expect(result.ok).toBe(false);
  expect(stop.pinned).toBe(false);
});
