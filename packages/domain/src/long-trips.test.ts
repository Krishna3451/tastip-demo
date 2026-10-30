import { expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { MAX_TRIP_DAYS } from "./limits";
import { parseRoutePrompt } from "./prompt";
import { routeStayDates, validRoute } from "./route";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";
import type { TripRoute } from "./types";

test("a thirty-day city route crosses leap day and survives storage, replay and undo", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  const route: TripRoute = {
    startDate: "2028-02-20",
    stays: [
      { id: "lisbon", destinationId: "lisbon", days: 15 },
      { id: "porto", destinationId: "porto", days: 15 },
    ],
    transfers: [{ id: "north", fromStayId: "lisbon", toStayId: "porto", mode: "train" }],
  };
  const command = {
    id: "long-route",
    baseVersion: 1,
    operations: [{ type: "set-route" as const, route }],
  };
  const result = applyTripCommand(before, command);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.trip.days).toHaveLength(30);
  expect(result.trip.days[9]!.date).toBe("2028-02-29");
  expect(result.trip.days[29]!.date).toBe("2028-03-20");
  expect(routeStayDates(route).map((stay) => stay.nights)).toEqual([15, 14]);
  expect(result.trip.stops).toEqual(before.stops);
  expect(result.trip.stops.every((stop) => Number(stop.dayId.slice(4)) <= 3)).toBe(true);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)))!;
  expect(restored).not.toBeNull();
  const replay = applyTripCommand(restored, command);
  expect(replay.ok && replay.replayed).toBe(true);
  const undone = undoTripCommand(restored, result.receipt, "undo-long-route");
  expect(undone.ok && undone.trip.days).toEqual(before.days);
});

test("duration remains bounded without creating repeat sample visits", () => {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: MAX_TRIP_DAYS });
  expect(trip.days).toHaveLength(30);
  expect(new Set(trip.stops.map((stop) => stop.placeId)).size).toBe(trip.stops.length);
  expect(trip.stops).toHaveLength(8);
  expect(parseStoredTrip(trip)?.days).toHaveLength(30);
  expect(() => createDemoTrip({ ...DEFAULT_BRIEF, days: MAX_TRIP_DAYS + 1 })).toThrow("30 days");
  expect(
    validRoute({
      startDate: "2028-02-20",
      stays: [{ id: "a", destinationId: "lisbon", days: 31 }],
      transfers: [],
    }),
  ).toBe(false);
  expect(
    validRoute({
      startDate: "2028-02-20",
      stays: Array.from({ length: 8 }, (_, index) => ({
        id: `stay-${index}`,
        destinationId: "lisbon",
        days: 1,
      })),
      transfers: [],
    }),
  ).toBe(false);
});

test("route prompt parsing preserves every city for an explicit bounded review", () => {
  const prompt = parseRoutePrompt(
    "Lisbon, Porto, Paris, Lyon, Rome, Milan, Kyoto, Tokyo for 30 days",
  );
  expect(prompt.days).toBe(30);
  expect(prompt.cityQueries).toHaveLength(8);
  expect(prompt.cityQueries.at(-1)).toBe("Tokyo");
});
