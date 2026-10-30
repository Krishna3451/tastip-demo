import { describe, expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { dateAt, destinationForDay, routeStayDates, validRoute } from "./route";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";
import type { CommandResult, TripRoute } from "./types";

const route: TripRoute = {
  startDate: "2028-02-28",
  stays: [
    { id: "lisbon-stay", destinationId: "lisbon", days: 3 },
    { id: "porto-stay", destinationId: "porto", days: 2 },
  ],
  transfers: [
    { id: "transfer-1", fromStayId: "lisbon-stay", toStayId: "porto-stay", mode: "train" },
  ],
};
function accepted(result: CommandResult) {
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

describe("dated city routes", () => {
  test("a flexible multi-city route keeps dates open through reload, replay and later date changes", () => {
    const before = createDemoTrip(DEFAULT_BRIEF);
    const flexible = { ...route, startDate: null };
    expect(validRoute(flexible)).toBe(true);
    expect(validRoute({ ...route, startDate: undefined })).toBe(false);
    const command = {
      id: "flex-route",
      baseVersion: before.version,
      operations: [{ type: "set-route" as const, route: flexible }],
    };
    const result = accepted(applyTripCommand(before, command));
    const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
    expect(restored?.days.map((day) => day.date)).toEqual([null, null, null, null, null]);
    expect(destinationForDay(result.trip, result.trip.days[3]!.id)).toBe("porto");
    expect(
      routeStayDates(flexible).map((stay) => [stay.arrival, stay.departure, stay.nights]),
    ).toEqual([
      [null, null, 3],
      [null, null, 1],
    ]);
    expect(restored && accepted(applyTripCommand(restored, command)).replayed).toBe(true);
    const dated = accepted(
      applyTripCommand(result.trip, {
        id: "set-dates",
        baseVersion: result.trip.version,
        operations: [{ type: "set-route", route }],
      }),
    );
    expect(dated.trip.days[0]?.date).toBe("2028-02-28");
    expect(dated.trip.stops).toEqual(result.trip.stops);
    const undone = accepted(undoTripCommand(dated.trip, dated.receipt, "undo-dates"));
    expect(undone.trip.route?.startDate).toBeNull();
    expect(undone.trip.days.every((day) => day.date === null)).toBe(true);
    const corrupted = structuredClone(undone.trip);
    corrupted.days[0]!.date = "2028-02-28";
    expect(parseStoredTrip(corrupted)).toBeNull();
  });
  test("adds city days without inventing visits; calendar, nights, replay, storage and undo agree", () => {
    const before = createDemoTrip(DEFAULT_BRIEF);
    const command = {
      id: "city-route",
      baseVersion: before.version,
      operations: [{ type: "set-route" as const, route }],
    };
    const result = accepted(applyTripCommand(before, command));
    expect(result.trip.days.map((day) => day.date)).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
      "2028-03-02",
      "2028-03-03",
    ]);
    expect(result.trip.stops).toEqual(before.stops);
    expect(result.trip.brief.days).toBe(5);
    expect(
      routeStayDates(route).map(({ nights, arrival, departure }) => ({
        nights,
        arrival,
        departure,
      })),
    ).toEqual([
      { nights: 3, arrival: "2028-02-28", departure: "2028-03-02" },
      { nights: 1, arrival: "2028-03-02", departure: "2028-03-03" },
    ]);
    const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)))!;
    expect(restored).not.toBeNull();
    expect(accepted(applyTripCommand(restored, command)).replayed).toBe(true);
    expect(accepted(undoTripCommand(restored, result.receipt, "undo-route")).trip.days).toEqual(
      before.days,
    );
    expect(
      accepted(undoTripCommand(restored, result.receipt, "undo-route")).trip.route,
    ).toBeUndefined();
  });

  test("rejects reassigning city visits, cross-city moves and deletion of populated days atomically", () => {
    const before = createDemoTrip(DEFAULT_BRIEF);
    const invalid = structuredClone(route);
    invalid.stays[0]!.days = 1;
    expect(
      applyTripCommand(before, {
        id: "bad",
        baseVersion: 1,
        operations: [{ type: "set-route", route: invalid }],
      }).ok,
    ).toBe(false);
    const routed = accepted(
      applyTripCommand(before, {
        id: "route",
        baseVersion: 1,
        operations: [{ type: "set-route", route }],
      }),
    ).trip;
    const moved = applyTripCommand(routed, {
      id: "move",
      baseVersion: 2,
      operations: [
        { type: "move-stop", stopId: routed.stops[0]!.id, dayId: "day-4", startTime: "10:00" },
      ],
    });
    expect(moved.ok ? "accepted" : moved.error.code).toBe("CITY_MISMATCH");
    expect(before.version).toBe(1);
    const shortened = { ...route, stays: [{ ...route.stays[0]!, days: 1 }], transfers: [] };
    const deleted = applyTripCommand(routed, {
      id: "delete",
      baseVersion: 2,
      operations: [{ type: "set-route", route: shortened }],
    });
    expect(deleted.ok ? "accepted" : deleted.error.code).toBe("DAYS_HAVE_VISITS");
  });

  test("rejects invalid dates, unknown cities, broken transfers and corrupted saved route", () => {
    expect(validRoute({ ...route, startDate: "2027-02-29" })).toBe(false);
    expect(validRoute({ ...route, transfers: [] })).toBe(false);
    expect(validRoute({ ...route, stays: [{ id: "a", destinationId: "unknown", days: 3 }] })).toBe(
      false,
    );
    expect(dateAt("2027-12-31", 1)).toBe("2028-01-01");
    const trip = accepted(
      applyTripCommand(createDemoTrip(DEFAULT_BRIEF), {
        id: "route",
        baseVersion: 1,
        operations: [{ type: "set-route", route }],
      }),
    ).trip;
    trip.days[0]!.date = "2028-03-01";
    expect(parseStoredTrip(trip)).toBeNull();
    expect(parseStoredTrip(createDemoTrip(DEFAULT_BRIEF))).not.toBeNull();
  });
});
