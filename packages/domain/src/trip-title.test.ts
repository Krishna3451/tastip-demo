import { expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";
import { getTripTitle, validTripTitle } from "./trip-title";

test("trip names persist, replay and undo while older drafts keep city names", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  expect(getTripTitle(before)).toBe("Lisbon");
  const command = {
    id: "name-trip",
    baseVersion: 1,
    operations: [{ type: "set-trip-title" as const, title: "  A week of little discoveries  " }],
  };
  const named = applyTripCommand(before, command);
  if (!named.ok) throw new Error(named.error.message);
  expect(named.trip.title).toBe("A week of little discoveries");
  expect(before.title).toBeUndefined();
  expect(named.trip.stops).toEqual(before.stops);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(named.trip)));
  if (!restored) throw new Error("Trip name could not be restored");
  expect(getTripTitle(restored)).toBe("A week of little discoveries");
  const replay = applyTripCommand(restored, command);
  expect(replay.ok && replay.replayed).toBe(true);
  expect(applyTripCommand(restored, { ...command, id: "stale-name" }).ok).toBe(false);
  const cleared = applyTripCommand(restored, {
    id: "reset-name",
    baseVersion: restored.version,
    operations: [{ type: "set-trip-title", title: "" }],
  });
  if (!cleared.ok) throw new Error(cleared.error.message);
  expect(getTripTitle(cleared.trip)).toBe("Lisbon");
  expect(parseStoredTrip(cleared.trip)?.title).toBeUndefined();
  const undone = undoTripCommand(cleared.trip, cleared.receipt, "undo-name-reset");
  expect(undone.ok && undone.trip.title).toBe(restored.title);
});

test("invalid trip names reject whole edits and corrupted backups", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  for (const title of ["", " ", "x".repeat(121), "Bad\nname", "Bad\u0000name", null, 123]) {
    expect(validTripTitle(title)).toBe(false);
    expect(parseStoredTrip({ ...before, title })).toBeNull();
  }
  expect(
    applyTripCommand(before, {
      id: "bad-name-batch",
      baseVersion: 1,
      operations: [
        { type: "pin-stop", stopId: before.stops[0]!.id, pinned: true },
        { type: "set-trip-title", title: "x".repeat(121) },
      ],
    }).ok,
  ).toBe(false);
  expect(before.stops[0]?.pinned).toBe(false);
});
