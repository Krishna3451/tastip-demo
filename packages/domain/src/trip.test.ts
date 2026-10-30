import { describe, expect, test } from "bun:test";
import { createDemoTrip, createTripFromPlaces, DEFAULT_BRIEF } from "./fixtures";
import { applyTripCommand, getDayStops, undoTripCommand, validateTrip } from "./trip";
import type { CommandResult, Place, Trip, TripCommand, TripOperation } from "./types";

function fixture(): Trip {
  return createDemoTrip({ ...DEFAULT_BRIEF, interests: [...DEFAULT_BRIEF.interests] });
}

function command(
  trip: Trip,
  operations: TripOperation[],
  id: string = crypto.randomUUID(),
): TripCommand {
  return { id, baseVersion: trip.version, operations };
}

function accepted(result: CommandResult) {
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

describe("canonical trip commands", () => {
  test("Qloo rank changes selected stops in the shared composer without comparing scores", () => {
    const inventory: Place[] = fixture()
      .places.slice(0, 5)
      .map((place, index) => ({
        ...place,
        source: "qloo",
        taste: { queryId: "real-query-contract", rank: 5 - index, score: index === 0 ? 1 : 0.1 },
      }));
    const trip = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 1 }, inventory);
    expect(trip.stops.map((stop) => stop.placeId)).toEqual([
      inventory[4]!.id,
      inventory[3]!.id,
      inventory[2]!.id,
    ]);
    expect(inventory[0]!.taste!.rank).toBe(5);
    const reranked = inventory.map((place, index) => ({
      ...place,
      taste: { ...place.taste!, rank: index + 1 },
    }));
    const alternate = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 1 }, reranked);
    expect(alternate.stops.map((stop) => stop.placeId)).toEqual([
      inventory[0]!.id,
      inventory[1]!.id,
      inventory[2]!.id,
    ]);
    expect(trip.stops.map((stop) => stop.placeId)).not.toEqual(
      alternate.stops.map((stop) => stop.placeId),
    );
  });

  test("undersupplied inventory leaves partial and empty days instead of duplicating real venues", () => {
    const inventory: Place[] = fixture()
      .places.slice(0, 4)
      .map((place, index) => ({
        ...place,
        source: "qloo",
        taste: { queryId: "query-one", rank: index + 1 },
      }));
    const trip = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 3 }, inventory);
    expect(trip.stops.length).toBe(4);
    expect(new Set(trip.stops.map((stop) => stop.placeId)).size).toBe(4);
    expect(getDayStops(trip, trip.days[0]!.id)).toHaveLength(3);
    expect(getDayStops(trip, trip.days[1]!.id)).toHaveLength(1);
    expect(getDayStops(trip, trip.days[2]!.id)).toHaveLength(0);
    expect(validateTrip(trip)).toEqual([]);
    expect(
      trip.places.every(
        (place) => place.practical.hours === "unknown" && place.practical.cost === "unknown",
      ),
    ).toBe(true);
  });

  test("empty inventory yields an editable empty draft and demo inventory preserves neutral order", () => {
    const empty = createTripFromPlaces(DEFAULT_BRIEF, []);
    expect(empty.stops).toHaveLength(0);
    expect(empty.days).toHaveLength(3);
    expect(validateTrip(empty)).toEqual([]);
    const inventory = fixture().places.slice(0, 4).reverse();
    const demo = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 1 }, inventory);
    expect(demo.stops.map((stop) => stop.placeId)).toEqual(
      inventory.slice(0, 3).map((place) => place.id),
    );
  });

  test("rejects mixed-query ranks, duplicate places, and malformed candidate evidence", () => {
    const inventory: Place[] = fixture()
      .places.slice(0, 2)
      .map((place, index) => ({
        ...place,
        source: "qloo",
        taste: { queryId: "query-one", rank: index + 1 },
      }));
    expect(() =>
      createTripFromPlaces(DEFAULT_BRIEF, [
        inventory[0]!,
        { ...inventory[1]!, taste: { queryId: "query-two", rank: 2 } },
      ]),
    ).toThrow("one Qloo query");
    expect(() => createTripFromPlaces(DEFAULT_BRIEF, [inventory[0]!, inventory[0]!])).toThrow(
      "unique",
    );
    expect(() =>
      createTripFromPlaces(DEFAULT_BRIEF, [{ ...inventory[0]!, lat: Number.NaN }]),
    ).toThrow("coordinates");
    expect(() =>
      createTripFromPlaces(DEFAULT_BRIEF, [
        { ...inventory[0]!, taste: { queryId: "query-one", rank: 0 } },
      ]),
    ).toThrow("positive rank");
    expect(() =>
      createTripFromPlaces(DEFAULT_BRIEF, [
        { ...inventory[0]!, taste: { queryId: "query-one", rank: 1, score: 3 } },
      ]),
    ).toThrow("documented range");
    expect(() =>
      createTripFromPlaces(DEFAULT_BRIEF, [inventory[0]!, fixture().places[1]!]),
    ).toThrow("separate");
  });

  test("demo trips are explicit synthetic data with unknown hours and cost", () => {
    const trip = fixture();
    expect(validateTrip(trip)).toEqual([]);
    expect(
      trip.places.every(
        (place) =>
          place.source === "demo" &&
          place.name.startsWith("Demo · ") &&
          !place.taste &&
          place.practical.hours === "unknown" &&
          place.practical.cost === "unknown",
      ),
    ).toBe(true);
    expect(trip.days.every((day) => day.date === null)).toBe(true);
  });

  test("preserves a zero budget as a declared value", () => {
    const trip = createDemoTrip({ ...DEFAULT_BRIEF, budget: 0 });
    expect(trip.brief.budget).toBe(0);
    expect(validateTrip(trip)).toEqual([]);
  });

  test("editing one visit never changes another visit of the same place", () => {
    const trip = fixture();
    const first = trip.stops[0]!;
    const repeat = trip.stops.find((stop) => stop.id !== first.id && stop.dayId !== first.dayId)!;
    repeat.placeId = first.placeId;
    const result = accepted(
      applyTripCommand(trip, command(trip, [{ type: "remove-stop", stopId: first.id }])),
    );
    expect(result.trip.stops.some((stop) => stop.id === first.id)).toBe(false);
    expect(result.trip.stops.find((stop) => stop.id === repeat.id)?.placeId).toBe(first.placeId);
    expect(result.trip.places.some((place) => place.id === first.placeId)).toBe(true);
  });

  test("a lost acknowledgement is replayed across persistence without double application", () => {
    const trip = fixture();
    const edit = command(trip, [{ type: "remove-stop", stopId: trip.stops[0]!.id }], "remove-once");
    const first = accepted(applyTripCommand(trip, edit));
    const restored = JSON.parse(JSON.stringify(first.trip)) as Trip;
    const retry = accepted(applyTripCommand(restored, edit));
    expect(retry.replayed).toBe(true);
    expect(retry.trip.version).toBe(first.trip.version);
    expect(retry.trip.stops.length).toBe(trip.stops.length - 1);
    expect(retry.receipt).toEqual(first.receipt);
  });

  test("replaying an older command acknowledges it without discarding a newer edit", () => {
    const trip = fixture();
    const edit = command(
      trip,
      [{ type: "pin-stop", stopId: trip.stops[0]!.id, pinned: true }],
      "first",
    );
    const first = accepted(applyTripCommand(trip, edit));
    const second = accepted(
      applyTripCommand(
        first.trip,
        command(first.trip, [{ type: "remove-stop", stopId: trip.stops[1]!.id }]),
      ),
    );
    const retry = accepted(applyTripCommand(second.trip, edit));
    expect(retry.trip.version).toBe(second.trip.version);
    expect(retry.trip.stops).toEqual(second.trip.stops);
    expect(retry.receipt.afterVersion).toBe(first.trip.version);
  });

  test("reusing a command ID for a different payload is rejected", () => {
    const trip = fixture();
    const first = accepted(
      applyTripCommand(
        trip,
        command(trip, [{ type: "pin-stop", stopId: trip.stops[0]!.id, pinned: true }], "same-id"),
      ),
    );
    const result = applyTripCommand(
      first.trip,
      command(first.trip, [{ type: "remove-stop", stopId: trip.stops[1]!.id }], "same-id"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("COMMAND_ID_REUSED");
  });

  test("missing persisted receipt prevents unsafe duplicate application", () => {
    const trip = fixture();
    trip.appliedCommandIds.push("old-edit");
    const result = applyTripCommand(
      trip,
      command(trip, [{ type: "remove-stop", stopId: trip.stops[0]!.id }], "old-edit"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("COMMAND_RESULT_UNAVAILABLE");
  });

  test("stale async proposals cannot overwrite a newer trip", () => {
    const trip = fixture();
    const stale = command(trip, [{ type: "remove-stop", stopId: trip.stops[1]!.id }]);
    const first = accepted(
      applyTripCommand(
        trip,
        command(trip, [{ type: "pin-stop", stopId: trip.stops[0]!.id, pinned: true }]),
      ),
    );
    const result = applyTripCommand(first.trip, stale);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STALE_VERSION");
    expect(first.trip.stops.length).toBe(trip.stops.length);
  });

  test("a failed operation rolls back the whole command", () => {
    const trip = fixture();
    const before = structuredClone(trip);
    const result = applyTripCommand(
      trip,
      command(trip, [
        { type: "pin-stop", stopId: trip.stops[0]!.id, pinned: true },
        { type: "replace-stop", stopId: trip.stops[0]!.id, placeId: trip.places[1]!.id },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(trip).toEqual(before);
  });

  test("pinning identity permits moving its flexible time but blocks replacement and removal", () => {
    const trip = fixture();
    const stopId = trip.stops[0]!.id;
    const pinned = accepted(
      applyTripCommand(trip, command(trip, [{ type: "pin-stop", stopId, pinned: true }])),
    );
    const moved = accepted(
      applyTripCommand(
        pinned.trip,
        command(pinned.trip, [{ type: "set-start-time", stopId, startTime: "10:00" }]),
      ),
    );
    expect(moved.trip.stops.find((stop) => stop.id === stopId)?.startTime).toBe("10:00");
    expect(
      applyTripCommand(moved.trip, command(moved.trip, [{ type: "remove-stop", stopId }])).ok,
    ).toBe(false);
    expect(
      applyTripCommand(
        moved.trip,
        command(moved.trip, [{ type: "replace-stop", stopId, placeId: trip.places[1]!.id }]),
      ).ok,
    ).toBe(false);
  });

  test("fixing time prevents moving it and is independent of the place pin", () => {
    const trip = fixture();
    const stopId = trip.stops[0]!.id;
    const locked = accepted(
      applyTripCommand(trip, command(trip, [{ type: "lock-time", stopId, timeLocked: true }])),
    );
    expect(locked.trip.stops[0]!.pinned).toBe(false);
    expect(
      applyTripCommand(
        locked.trip,
        command(locked.trip, [
          { type: "move-stop", stopId, dayId: trip.days[1]!.id, startTime: "09:30" },
        ]),
      ).ok,
    ).toBe(false);
    const replacement = accepted(
      applyTripCommand(
        locked.trip,
        command(locked.trip, [{ type: "replace-stop", stopId, placeId: trip.places[6]!.id }]),
      ),
    );
    expect(replacement.trip.stops[0]!.startTime).toBe(trip.stops[0]!.startTime);
  });

  test("rejects a newly overlapping or cross-midnight visit", () => {
    const trip = fixture();
    const stopId = trip.stops[1]!.id;
    const overlap = applyTripCommand(
      trip,
      command(trip, [{ type: "set-start-time", stopId, startTime: "10:00" }]),
    );
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.error.code).toBe("TIME_OVERLAP");
    const midnight = applyTripCommand(
      trip,
      command(trip, [{ type: "set-start-time", stopId, startTime: "23:30" }]),
    );
    expect(midnight.ok).toBe(false);
    if (!midnight.ok) expect(midnight.error.code).toBe("INVALID_TIME");
  });

  test("undo restores the scoped edit and advances version monotonically", () => {
    const trip = fixture();
    const result = accepted(
      applyTripCommand(trip, command(trip, [{ type: "remove-stop", stopId: trip.stops[0]!.id }])),
    );
    const undo = accepted(undoTripCommand(result.trip, result.receipt, "undo-once"));
    expect(undo.trip.stops).toEqual(trip.stops);
    expect(undo.trip.version).toBe(result.trip.version + 1);
    const retry = accepted(undoTripCommand(undo.trip, result.receipt, "undo-once"));
    expect(retry.replayed).toBe(true);
    expect(retry.trip.version).toBe(undo.trip.version);
  });

  test("undo refuses to overwrite intervening accepted edits", () => {
    const trip = fixture();
    const first = accepted(
      applyTripCommand(trip, command(trip, [{ type: "remove-stop", stopId: trip.stops[0]!.id }])),
    );
    const next = accepted(
      applyTripCommand(
        first.trip,
        command(first.trip, [{ type: "pin-stop", stopId: trip.stops[1]!.id, pinned: true }]),
      ),
    );
    const undo = undoTripCommand(next.trip, first.receipt, "undo-old");
    expect(undo.ok).toBe(false);
    if (!undo.ok) expect(undo.error.code).toBe("UNDO_CONFLICT");
  });

  test("undo uses its own recorded snapshot rather than a caller-modified receipt", () => {
    const trip = fixture();
    const first = accepted(
      applyTripCommand(trip, command(trip, [{ type: "remove-stop", stopId: trip.stops[0]!.id }])),
    );
    const forged = structuredClone(first.receipt);
    forged.before.stops = [];
    const undo = accepted(undoTripCommand(first.trip, forged, "undo-recorded"));
    expect(undo.trip.stops).toEqual(trip.stops);
  });

  test("chronological projection does not mutate canonical stop order", () => {
    const trip = fixture();
    trip.stops.reverse();
    const original = trip.stops.map((stop) => stop.id);
    expect(getDayStops(trip, trip.days[0]!.id).map((stop) => stop.startTime)).toEqual([
      "09:30",
      "12:30",
      "17:00",
    ]);
    expect(trip.stops.map((stop) => stop.id)).toEqual(original);
  });
});
