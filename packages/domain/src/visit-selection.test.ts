import { expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";
import type { CommandResult, TripStop } from "./types";

function accepted(result: CommandResult) {
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function qlooIdea() {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const place = trip.places[3]!;
  place.source = "qloo";
  place.taste = { queryId: "idea-selection-query", rank: 7, score: 0.62 };
  return { trip, place };
}

const visit = (placeId: string): TripStop => ({
  id: "selected-idea-visit",
  placeId,
  dayId: "day-1",
  startTime: "15:30",
  durationMinutes: 45,
  pinned: false,
  timeLocked: false,
});

test("scheduling a Qloo idea snapshots its query evidence without mutating the input and survives replay/undo", () => {
  const { trip, place } = qlooIdea();
  const stop = visit(place.id);
  const command = {
    id: "schedule-qloo-idea",
    baseVersion: trip.version,
    operations: [{ type: "add-stop" as const, stop }],
  };
  const result = accepted(applyTripCommand(trip, command));
  const added = result.trip.stops.find((item) => item.id === stop.id)!;
  expect(added.selection).toEqual(place.taste);
  expect(added.selection).not.toBe(place.taste);
  expect(stop.selection).toBeUndefined();
  expect(trip.stops.some((item) => item.id === stop.id)).toBe(false);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
  expect(restored?.stops.find((item) => item.id === stop.id)?.selection).toEqual(place.taste);
  expect(accepted(applyTripCommand(restored!, command)).replayed).toBe(true);
  expect(accepted(undoTripCommand(result.trip, result.receipt, "undo-idea")).trip.stops).toEqual(
    trip.stops,
  );
});

test("an explicit per-visit query remains distinct from catalog evidence and malformed evidence still rejects", () => {
  const { trip, place } = qlooIdea();
  const selection = { queryId: "original-visit-query", rank: 3 };
  const result = accepted(
    applyTripCommand(trip, {
      id: "explicit-selection",
      baseVersion: trip.version,
      operations: [{ type: "add-stop", stop: { ...visit(place.id), selection } }],
    }),
  );
  expect(result.trip.stops.find((item) => item.id === "selected-idea-visit")?.selection).toEqual(
    selection,
  );
  expect(result.trip.places.find((item) => item.id === place.id)?.taste).toEqual(place.taste);
  const malformed = { ...visit(place.id), selection: null } as unknown as TripStop;
  expect(
    applyTripCommand(trip, {
      id: "null-selection",
      baseVersion: trip.version,
      operations: [{ type: "add-stop", stop: malformed }],
    }).ok,
  ).toBe(false);
});

test("scheduling a fictional sample never creates Qloo evidence", () => {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const result = accepted(
    applyTripCommand(trip, {
      id: "sample-idea",
      baseVersion: trip.version,
      operations: [{ type: "add-stop", stop: visit(trip.places[3]!.id) }],
    }),
  );
  expect(
    result.trip.stops.find((item) => item.id === "selected-idea-visit")?.selection,
  ).toBeUndefined();
});
