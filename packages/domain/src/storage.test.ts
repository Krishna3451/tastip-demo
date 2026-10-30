import { describe, expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";

function corrupt(value: unknown, path: (string | number)[], replacement: unknown) {
  let target = value as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  const last = path.at(-1);
  if (last !== undefined) target[last] = replacement;
}

describe("stored trip boundary", () => {
  test("returns null without throwing for incomplete and wrong field shapes", () => {
    for (const value of [null, undefined, "trip", [], {}, { brief: [] }])
      expect(parseStoredTrip(value)).toBeNull();
    const cases: [(string | number)[], unknown][] = [
      [["brief", "pace"], "wild"],
      [["brief", "pace"], ["slow"]],
      [["brief", "days"], "3"],
      [["brief", "interests"], [null]],
      [["places", 0, "source"], "invented"],
      [["places", 0, "category"], ["cafe"]],
      [["stops", 0, "pinned"], "false"],
      [["stops", 0, "timeLocked"], null],
      [["stops", 0, "startTime"], "25:00"],
      [["places", 0, "lat"], Number.NaN],
      [["places", 0, "practical", "cost"], 0],
      [["stops", 1, "id"], "day-1-stop-1"],
      [["days", 0, "date"], "2026-02-30"],
      [["version"], -1],
    ];
    for (const [path, replacement] of cases) {
      const trip = createDemoTrip(DEFAULT_BRIEF);
      corrupt(trip, path, replacement);
      expect(parseStoredTrip(trip)).toBeNull();
    }
  });

  test("projects known fields and preserves zero budget and unknown practical facts", () => {
    const trip = createDemoTrip({ ...DEFAULT_BRIEF, budget: 0 });
    const parsed = parseStoredTrip({ ...trip, arbitrary: "ignored" });
    expect(parsed?.brief.budget).toBe(0);
    expect(parsed?.places[0]?.practical).toEqual({ hours: "unknown", cost: "unknown" });
    expect(parsed).not.toHaveProperty("arbitrary");
    expect(parsed).toEqual(trip);
  });

  test("valid restored receipts retain retry acknowledgements and undo", () => {
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const edit = {
      id: "stored-remove",
      baseVersion: trip.version,
      operations: [{ type: "remove-stop" as const, stopId: trip.stops[0]!.id }],
    };
    const accepted = applyTripCommand(trip, edit);
    if (!accepted.ok) throw new Error(accepted.error.message);
    const restored = parseStoredTrip(JSON.parse(JSON.stringify(accepted.trip)));
    expect(restored).not.toBeNull();
    if (!restored) throw new Error("Expected valid restored trip");
    const retry = applyTripCommand(restored, edit);
    expect(retry.ok && retry.replayed).toBe(true);
    const undone = undoTripCommand(restored, accepted.receipt, "stored-undo");
    if (!undone.ok) throw new Error(undone.error.message);
    const restoredUndo = parseStoredTrip(JSON.parse(JSON.stringify(undone.trip)));
    expect(restoredUndo?.stops).toEqual(trip.stops);
    expect(restoredUndo?.version).toBe(3);
  });

  test("rejects foreign, recursive, disconnected, and fabricated receipt snapshots", () => {
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const first = applyTripCommand(trip, {
      id: "first",
      baseVersion: trip.version,
      operations: [{ type: "remove-stop", stopId: trip.stops[0]!.id }],
    });
    if (!first.ok) throw new Error(first.error.message);
    const second = applyTripCommand(first.trip, {
      id: "second",
      baseVersion: first.trip.version,
      operations: [{ type: "pin-stop", stopId: trip.stops[1]!.id, pinned: true }],
    });
    if (!second.ok) throw new Error(second.error.message);
    const cases: [(string | number)[], unknown][] = [
      [["commandLog", 0, "before", "id"], "foreign-trip"],
      [["commandLog", 0, "before", "commandLog"], []],
      [["commandLog", 0, "fingerprint"], "not-json"],
      [["commandLog", 0, "affectedStopIds"], ["fabricated-stop"]],
      [["commandLog", 1, "before", "stops", 0, "pinned"], true],
      [["commandLog", 0, "beforeVersion"], 100],
      [["commandLog", 0, "commandId"], "not-applied"],
    ];
    for (const [path, replacement] of cases) {
      const corrupted = structuredClone(second.trip);
      corrupt(corrupted, path, replacement);
      expect(parseStoredTrip(corrupted)).toBeNull();
    }
  });
});
