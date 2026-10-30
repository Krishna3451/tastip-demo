import { expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";
import type { TripOperation } from "./types";

test("editing and clearing the trip brief preserves categories, dates and accepted visits across replay and undo", () => {
  const before = createDemoTrip({
    ...DEFAULT_BRIEF,
    details: {
      request: "Original request",
      travelers: { adults: 1, children: 1, infants: 0, pets: 1 },
      flexibleMonths: ["2027-03"],
    },
  });
  const command = {
    id: "edit-trip-request",
    baseVersion: before.version,
    operations: [
      {
        type: "set-trip-request" as const,
        request: "Edited private trip brief\nKeep a relaxed pace.",
      },
    ],
  };
  const result = applyTripCommand(before, command);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.trip.brief.details?.request).toBe(command.operations[0]!.request);
  expect(result.trip.brief.details?.travelers).toEqual(before.brief.details?.travelers);
  expect(result.trip.brief.details?.flexibleMonths).toEqual(["2027-03"]);
  expect(result.trip.stops).toEqual(before.stops);
  expect(result.trip.days).toEqual(before.days);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
  expect(restored).not.toBeNull();
  const replay = restored && applyTripCommand(restored, command);
  expect(replay?.ok && replay.replayed).toBe(true);
  const cleared = applyTripCommand(result.trip, {
    id: "clear-trip-request",
    baseVersion: result.trip.version,
    operations: [{ type: "set-trip-request", request: "" }],
  });
  if (!cleared.ok) throw new Error(cleared.error.message);
  expect(parseStoredTrip(cleared.trip)?.brief.details?.request).toBe("");
  const undo = undoTripCommand(cleared.trip, cleared.receipt, "undo-clear-trip-request");
  expect(undo.ok && undo.trip.brief.details?.request).toBe(command.operations[0]!.request);
});

test("invalid trip brief edits reject atomically, including earlier valid edits", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  for (const request of ["x".repeat(2001), null, 12, {}]) {
    const result = applyTripCommand(before, {
      id: crypto.randomUUID(),
      baseVersion: before.version,
      operations: [
        { type: "set-pace", pace: "full" },
        { type: "set-trip-request", request } as TripOperation,
      ],
    });
    expect(result.ok).toBe(false);
    expect(before.brief).toEqual(DEFAULT_BRIEF);
  }
});
