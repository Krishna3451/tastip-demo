import { expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";
import type { TripOperation } from "./types";

test("traveler categories update the party atomically while retaining the original brief and plan", () => {
  const before = createDemoTrip({
    ...DEFAULT_BRIEF,
    details: {
      request: "Private original request",
      flexibleMonths: ["2027-03"],
      travelers: { adults: 2, children: 0, infants: 0, pets: 1 },
    },
  });
  const command = {
    id: "update-categories",
    baseVersion: before.version,
    operations: [
      {
        type: "set-travelers" as const,
        travelers: { adults: 2, children: 2, infants: 1, pets: 2 },
      },
    ],
  };
  const result = applyTripCommand(before, command);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.trip.brief.partySize).toBe(5);
  expect(result.trip.brief.details).toEqual({
    request: "Private original request",
    flexibleMonths: ["2027-03"],
    travelers: command.operations[0]!.travelers,
  });
  expect(result.trip.stops).toEqual(before.stops);
  expect(result.trip.days).toEqual(before.days);
  expect(result.trip.places).toEqual(before.places);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
  expect(restored).not.toBeNull();
  const replay = restored && applyTripCommand(restored, command);
  expect(replay?.ok && replay.replayed).toBe(true);
  const undo = restored && undoTripCommand(restored, result.receipt, "undo-categories");
  expect(undo?.ok && undo.trip.brief).toEqual(before.brief);
});

test("invalid categories roll back a mixed edit without changing the current party", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  for (const travelers of [
    { adults: 0, children: 2, infants: 0, pets: 0 },
    { adults: 20, children: 1, infants: 0, pets: 0 },
    { adults: 2, children: -1, infants: 0, pets: 0 },
    { adults: 2, children: 0.5, infants: 0, pets: 0 },
    { adults: 2, children: 0, infants: 0, pets: 21 },
    { adults: 2, children: 0, infants: Number.NaN, pets: 0 },
  ]) {
    const result = applyTripCommand(before, {
      id: crypto.randomUUID(),
      baseVersion: before.version,
      operations: [
        { type: "set-pace", pace: "full" },
        { type: "set-travelers", travelers } as TripOperation,
      ],
    });
    expect(result.ok).toBe(false);
    expect(before.brief).toEqual(DEFAULT_BRIEF);
  }
});
