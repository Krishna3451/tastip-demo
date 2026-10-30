import { describe, expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { availableVisitTimes, cityRecommendationOperations } from "./scheduling";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";
import type { CommandResult, Place } from "./types";

const accepted = (result: CommandResult) => {
  if (!result.ok) throw new Error(result.error.message);
  return result;
};

test("draft visit spaces account for the requested duration and reject missing days", () => {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  expect(availableVisitTimes(trip, "day-1")).toEqual(["15:30", "18:30"]);
  expect(availableVisitTimes(trip, "day-1", 120)).toEqual(["18:30"]);
  expect(availableVisitTimes(trip, "unknown", 60)).toEqual([]);
  for (const duration of [0, -1, 1.5, Number.NaN, 1441])
    expect(availableVisitTimes(trip, "day-1", duration)).toEqual([]);
  trip.stops = [];
  expect(availableVisitTimes(trip, "day-1", 120)).toEqual(["09:30", "12:30", "15:30", "18:30"]);
});

describe("city-scoped ranked planning", () => {
  test("imports one query and fills new-city days without changing existing visits; replay and undo remain durable", () => {
    const before = createDemoTrip(DEFAULT_BRIEF);
    const routed = accepted(
      applyTripCommand(before, {
        id: "route",
        baseVersion: 1,
        operations: [
          {
            type: "set-route",
            route: {
              startDate: "2028-06-10",
              stays: [
                { id: "a", destinationId: "lisbon", days: 3 },
                { id: "b", destinationId: "porto", days: 2 },
              ],
              transfers: [{ id: "ab", fromStayId: "a", toStayId: "b", mode: "train" }],
            },
          },
        ],
      }),
    ).trip;
    const candidates: Place[] = [7, 2, 9, 4, 12, 10].map((rank) => ({
      id: `porto-${rank}`,
      destinationId: "porto",
      name: `Contract fixture ${rank}`,
      category: "culture",
      lat: 41.15,
      lng: -8.62,
      description: "Synthetic contract fixture",
      source: "qloo",
      taste: { queryId: "porto-query", rank },
      practical: { hours: "unknown", cost: "unknown" },
    }));
    const command = {
      id: "fill",
      baseVersion: routed.version,
      operations: cityRecommendationOperations(routed, "porto", candidates),
    };
    const result = accepted(applyTripCommand(routed, command));
    expect(result.trip.stops.slice(0, before.stops.length)).toEqual(before.stops);
    const newStops = result.trip.stops.slice(before.stops.length);
    expect(newStops[0]?.startTime).toBe("15:00");
    expect(newStops[0]?.placeId).toBe("porto-2");
    expect(newStops.every((stop) => ["day-4", "day-5"].includes(stop.dayId))).toBe(true);
    expect(result.trip.places.find((place) => place.id === "porto-9")?.taste).toEqual({
      queryId: "porto-query",
      rank: 9,
    });
    const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
    expect(restored).not.toBeNull();
    expect(accepted(applyTripCommand(restored!, command)).replayed).toBe(true);
    expect(accepted(undoTripCommand(result.trip, result.receipt, "undo-fill")).trip.stops).toEqual(
      routed.stops,
    );
  });
  test("ideas add/remove and notes remain distinct; duration overlap or locked change rejects atomically", () => {
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const note = accepted(
      applyTripCommand(trip, {
        id: "note",
        baseVersion: 1,
        operations: [
          {
            type: "annotate-day",
            dayId: "day-1",
            label: "A quiet beginning",
            note: "Keep the evening free.",
          },
        ],
      }),
    ).trip;
    expect(note.stops).toEqual(trip.stops);
    expect(parseStoredTrip(note)?.days[0]?.note).toBe("Keep the evening free.");
    const bad = applyTripCommand(note, {
      id: "duration",
      baseVersion: 2,
      operations: [{ type: "set-duration", stopId: "day-1-stop-1", durationMinutes: 300 }],
    });
    expect(bad.ok ? "accepted" : bad.error.code).toBe("TIME_OVERLAP");
    const added = accepted(
      applyTripCommand(note, {
        id: "add-idea",
        baseVersion: 2,
        operations: [
          {
            type: "add-stop",
            stop: {
              id: "idea-visit",
              placeId: trip.places[7]!.id,
              dayId: "day-3",
              startTime: "18:00",
              durationMinutes: 45,
              pinned: false,
              timeLocked: false,
            },
          },
        ],
      }),
    ).trip;
    expect(parseStoredTrip(added)?.stops.find((stop) => stop.id === "idea-visit")).toBeDefined();
  });
  test("arbitrary resolved cities persist with timezone and reject invalid location metadata", () => {
    const destination = {
      id: "geonames-2988507",
      name: "Paris",
      country: "France",
      lat: 48.85,
      lng: 2.35,
      timeZone: "Europe/Paris",
    };
    const trip = createDemoTrip({ ...DEFAULT_BRIEF, destinationId: destination.id, destination });
    expect(parseStoredTrip(trip)?.brief.destination).toEqual(destination);
    trip.brief.destination!.timeZone = "Unknown/Invalid";
    expect(parseStoredTrip(trip)).toBeNull();
  });
});

test("recalling an existing idea retains this query's visit evidence without rewriting earlier place evidence", () => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  const old = trip.places[7]!;
  trip.stops = trip.stops.filter((stop) => stop.placeId !== old.id);
  old.source = "qloo";
  old.taste = { queryId: "old-query", rank: 12 };
  const candidate: Place = { ...old, taste: { queryId: "new-query", rank: 3 } };
  const result = accepted(
    applyTripCommand(trip, {
      id: "recall",
      baseVersion: 1,
      operations: cityRecommendationOperations(trip, "lisbon", [candidate]),
    }),
  );
  const visit = result.trip.stops.find((stop) => stop.placeId === candidate.id)!;
  expect(visit.selection).toEqual({ queryId: "new-query", rank: 3 });
  expect(result.trip.places.find((place) => place.id === candidate.id)?.taste).toEqual({
    queryId: "old-query",
    rank: 12,
  });
  expect(
    parseStoredTrip(result.trip)?.stops.find((stop) => stop.id === visit.id)?.selection,
  ).toEqual(visit.selection);
});

test("title-only edits and clearing a note remain reloadable with receipts", () => {
  let trip = createDemoTrip(DEFAULT_BRIEF);
  for (const [index, note] of ["", "A little thought", ""].entries()) {
    trip = accepted(
      applyTripCommand(trip, {
        id: `note-${index}`,
        baseVersion: trip.version,
        operations: [{ type: "annotate-day", dayId: "day-1", label: "My first day", note }],
      }),
    ).trip;
    expect(parseStoredTrip(trip)).not.toBeNull();
  }
});

test("replacing a rated visit clears previous feedback and updates selection evidence", () => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  trip.stops[0]!.feedback = "less";
  trip.stops[0]!.selection = { queryId: "previous-venue", rank: 9 };
  const replacement = trip.places[1]!;
  replacement.source = "qloo";
  replacement.taste = { queryId: "replacement-query", rank: 3 };
  const changed = accepted(
    applyTripCommand(trip, {
      id: "replacement",
      baseVersion: 1,
      operations: [{ type: "replace-stop", stopId: trip.stops[0]!.id, placeId: replacement.id }],
    }),
  ).trip;
  expect(changed.stops[0]?.feedback).toBeUndefined();
  expect(changed.stops[0]?.selection).toEqual(replacement.taste);
  expect(parseStoredTrip(changed)).not.toBeNull();
});
