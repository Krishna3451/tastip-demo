import { describe, expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { transfersForDay, transferWindow, validRoute } from "./route";
import { availableVisitTimes, cityRecommendationOperations } from "./scheduling";
import { parseStoredTrip } from "./storage";
import { localTimeEpoch } from "./time";
import { applyTripCommand, undoTripCommand } from "./trip";
import type { CommandResult, TripRoute } from "./types";

function accepted(result: CommandResult) {
  if (!result.ok) throw new Error(result.error.message);
  return result;
}
function timedRoute(): TripRoute {
  return {
    startDate: "2028-07-10",
    stays: [
      { id: "lisbon", destinationId: "lisbon", days: 3 },
      { id: "porto", destinationId: "porto", days: 2 },
    ],
    transfers: [
      {
        id: "train",
        fromStayId: "lisbon",
        toStayId: "porto",
        mode: "train",
        timing: {
          source: "traveler",
          departure: { date: "2028-07-13", time: "09:00" },
          arrival: { date: "2028-07-13", time: "12:00" },
        },
      },
    ],
  };
}
function routed(route = timedRoute()) {
  return accepted(
    applyTripCommand(createDemoTrip(DEFAULT_BRIEF), {
      id: "route",
      baseVersion: 1,
      operations: [{ type: "set-route", route }],
    }),
  );
}

describe("traveler-entered intercity travel", () => {
  test("uses city zones and rejects missing, repeated, malformed and conflicting clock times", () => {
    expect(
      new Date(
        localTimeEpoch({ date: "2028-07-13", time: "09:00" }, "Europe/Lisbon"),
      ).toISOString(),
    ).toBe("2028-07-13T08:00:00.000Z");
    expect(() => localTimeEpoch({ date: "2028-03-26", time: "01:30" }, "Europe/Lisbon")).toThrow(
      "Skipped clock times",
    );
    expect(() => localTimeEpoch({ date: "2028-10-29", time: "01:30" }, "Europe/Lisbon")).toThrow(
      "repeated clock hour",
    );
    const first = localTimeEpoch(
      { date: "2028-10-29", time: "01:30", utcOffset: "+01:00" },
      "Europe/Lisbon",
    );
    const second = localTimeEpoch(
      { date: "2028-10-29", time: "01:30", utcOffset: "+00:00" },
      "Europe/Lisbon",
    );
    expect(second - first).toBe(3_600_000);
    expect(() =>
      localTimeEpoch({ date: "2028-07-13", time: "09:00", utcOffset: "+09:00" }, "Europe/Lisbon"),
    ).toThrow();
    expect(() => localTimeEpoch({ date: "2028-02-30", time: "12:00" }, "Europe/Lisbon")).toThrow();
    expect(() => localTimeEpoch({ date: "2028-07-13", time: "24:00" }, "Europe/Lisbon")).toThrow();
  });

  test("timing uses actual elapsed time across cities rather than comparing wall clocks", () => {
    const route = timedRoute();
    route.stays[1]!.destinationId = "kyoto";
    route.transfers[0]!.mode = "flight";
    route.transfers[0]!.timing!.arrival.time = "16:00";
    expect(validRoute(route)).toBe(false); // 16:00 Tokyo is before 09:00 Lisbon in July.
    route.transfers[0]!.timing!.arrival.time = "20:00";
    expect(validRoute(route)).toBe(true);
    const window = transferWindow(route, 0)!;
    expect(window.arrivalEpoch - window.departureEpoch).toBe(3 * 3_600_000);
    route.transfers[0]!.timing!.arrival.date = "2028-07-14";
    expect(validRoute(route)).toBe(false);
    route.transfers[0]!.timing!.arrival.date = "2028-07-13";
    route.transfers[0]!.timing!.departure.date = "2028-07-09";
    expect(validRoute(route)).toBe(false);
  });

  test("an overnight departure rejects conflicting existing visits atomically", () => {
    const before = createDemoTrip(DEFAULT_BRIEF);
    const route = timedRoute();
    route.transfers[0]!.timing!.departure = { date: "2028-07-12", time: "09:30" };
    const rejected = applyTripCommand(before, {
      id: "bad-route",
      baseVersion: 1,
      operations: [{ type: "set-route", route }],
    });
    expect(rejected.ok ? "accepted" : rejected.error.code).toBe("TRANSFER_CONFLICT");
    expect(before.route).toBeUndefined();
    expect(before.version).toBe(1);
    route.transfers[0]!.timing!.departure.time = "22:00";
    const overnight = routed(route).trip;
    expect(transfersForDay(overnight, "day-2")).toHaveLength(0);
    expect(transfersForDay(overnight, "day-3")).toHaveLength(1);
    expect(transfersForDay(overnight, "day-4")).toHaveLength(1);
  });

  test("arrival constraints apply to direct commands and survive storage, replay and undo", () => {
    const result = routed();
    const trip = result.trip;
    const place = {
      ...trip.places[0]!,
      id: "synthetic-porto",
      destinationId: "porto",
      source: "qloo" as const,
      taste: { queryId: "synthetic-test-query", rank: 1 },
    };
    const inventory = accepted(
      applyTripCommand(trip, {
        id: "porto-candidate",
        baseVersion: trip.version,
        operations: [{ type: "add-candidates", destinationId: "porto", places: [place] }],
      }),
    ).trip;
    const stop = {
      ...trip.stops[0]!,
      id: "porto-visit",
      placeId: place.id,
      dayId: "day-4",
      startTime: "11:30",
    };
    const blocked = applyTripCommand(inventory, {
      id: "before-arrival",
      baseVersion: inventory.version,
      operations: [{ type: "add-stop", stop }],
    });
    expect(blocked.ok ? "accepted" : blocked.error.code).toBe("TRANSFER_CONFLICT");
    const command = {
      id: "after-arrival",
      baseVersion: inventory.version,
      operations: [{ type: "add-stop" as const, stop: { ...stop, startTime: "12:00" } }],
    };
    const added = accepted(applyTripCommand(inventory, command));
    const restored = parseStoredTrip(JSON.parse(JSON.stringify(added.trip)))!;
    expect(restored).not.toBeNull();
    expect(restored.route?.transfers[0]?.timing).toEqual(timedRoute().transfers[0]!.timing);
    expect(accepted(applyTripCommand(restored, command)).replayed).toBe(true);
    const moved = applyTripCommand(restored, {
      id: "move-too-early",
      baseVersion: restored.version,
      operations: [{ type: "move-stop", stopId: stop.id, dayId: stop.dayId, startTime: "11:59" }],
    });
    expect(moved.ok ? "accepted" : moved.error.code).toBe("TRANSFER_CONFLICT");
    expect(accepted(undoTripCommand(restored, added.receipt, "undo-visit")).trip.stops).toEqual(
      inventory.stops,
    );
    const corrupt = structuredClone(restored);
    corrupt.route!.transfers[0]!.timing!.arrival.time = "08:00";
    expect(parseStoredTrip(corrupt)).toBeNull();
    expect(
      accepted(undoTripCommand(trip, result.receipt, "undo-route")).trip.route,
    ).toBeUndefined();
  });
  test("recommendations use entered arrival time and retain ideas when no visit window fits", () => {
    const route = timedRoute();
    route.transfers[0]!.timing!.arrival.time = "18:30";
    const trip = routed(route).trip;
    expect(availableVisitTimes(trip, "day-4")).toEqual(["18:30"]);
    const place = {
      ...trip.places[0]!,
      id: "synthetic-late-arrival",
      destinationId: "porto",
      source: "qloo" as const,
      taste: { queryId: "synthetic-late-query", rank: 12 },
    };
    const operations = cityRecommendationOperations(trip, "porto", [place]);
    expect(operations.find((operation) => operation.type === "add-stop")).toMatchObject({
      stop: { startTime: "18:30", dayId: "day-4", selection: { rank: 12 } },
    });
    expect(
      applyTripCommand(trip, { id: "late-recommendation", baseVersion: trip.version, operations })
        .ok,
    ).toBe(true);
    route.transfers[0]!.timing!.arrival.time = "23:30";
    const late = routed(route).trip;
    expect(availableVisitTimes(late, "day-4")).toEqual([]);
    expect(
      cityRecommendationOperations(late, "porto", [place])
        .filter((operation) => operation.type === "add-stop")
        .every((operation) => operation.stop.dayId !== "day-4"),
    ).toBe(true);
  });
});
