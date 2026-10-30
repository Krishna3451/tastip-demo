import { expect, test } from "bun:test";
import { dayFactWarnings, type WeeklyHours } from "./facts";
import { createTripFromPlaces, DEFAULT_BRIEF } from "./fixtures";
import { cityRecommendationOperations } from "./scheduling";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand, validateTrip } from "./trip";
import type { CommandResult, Place, TripBrief } from "./types";

const late: TripBrief = {
  ...DEFAULT_BRIEF,
  days: 1,
  tasteProfile: { seeds: [], dayStyle: "Culture", categories: ["culture"], rhythm: "late" },
};
const open = (opens: string, closes: string) => [{ opens, closes, closed: false }];
const closed = [{ opens: null, closes: null, closed: true }];
const candidate = (rank: number, hours?: WeeklyHours): Place => ({
  id: `qloo:synthetic-listed-hours-${rank}`,
  destinationId: "lisbon",
  name: `Synthetic museum ${rank}`,
  description: "Synthetic scheduling fixture, not a real venue.",
  source: "qloo",
  category: "culture",
  lat: 38.72,
  lng: -9.13,
  taste: { queryId: "synthetic-listed-hours-query", rank },
  practical: { hours: "unknown", cost: "unknown" },
  ...(hours ? { facts: { source: "qloo", retrievedAt: "2026-10-30T00:00:00Z", hours } } : {}),
});
const accepted = (result: CommandResult) => {
  if (!result.ok) throw new Error(result.error.message);
  return result;
};

test("dated automatic draft fits complete listed windows instead of putting late-rhythm museums at 20:00", () => {
  const inventory = [3, 1, 2].map((rank) => candidate(rank, { monday: open("11:30", "17:00") }));
  const before = structuredClone(inventory);
  const trip = createTripFromPlaces(late, inventory, "2028-02-28");
  expect(trip.stops.map((stop) => stop.startTime)).toEqual(["11:30", "15:00", "16:00"]);
  expect(trip.stops.map((stop) => stop.selection)).toEqual(
    [1, 2, 3].map((rank) => ({
      queryId: "synthetic-listed-hours-query",
      rank,
    })),
  );
  expect(dayFactWarnings(trip, "day-1")).toEqual([]);
  expect(validateTrip(trip)).toEqual([]);
  expect(parseStoredTrip(trip)?.stops).toEqual(trip.stops);
  expect(inventory).toEqual(before);
});

test("closed weekdays defer a new candidate within the city days; incompatible windows stay Ideas", () => {
  const inventory = [
    candidate(1, { monday: closed, tuesday: open("11:00", "12:00") }),
    candidate(2),
    candidate(3, { monday: open("08:00", "10:00"), tuesday: closed }),
  ];
  const trip = createTripFromPlaces({ ...late, days: 2 }, inventory, "2028-02-28");
  const [first, second] = inventory;
  if (!first || !second) throw new Error("Missing synthetic scheduling candidates");
  expect(trip.stops.map((stop) => [stop.placeId, stop.dayId, stop.startTime])).toEqual([
    [second.id, "day-1", "11:00"],
    [first.id, "day-2", "11:00"],
  ]);
  expect(trip.places).toHaveLength(3);
  expect(trip.stops.some((stop) => stop.placeId === inventory[2]?.id)).toBe(false);
  expect(dayFactWarnings(trip, "day-1")).toEqual([]);
  expect(dayFactWarnings(trip, "day-2")).toEqual([]);
});

test("undated, absent, empty, incomplete and ambiguous hours retain the existing illustrative fallback", () => {
  const undated = createTripFromPlaces(
    late,
    [1, 2, 3].map((rank) => candidate(rank, { monday: closed })),
  );
  expect(undated.stops.map((stop) => stop.startTime)).toEqual(["11:00", "15:00", "20:00"]);
  for (const inventory of [
    [candidate(1), candidate(2), candidate(3)],
    [
      candidate(1, { tuesday: closed }),
      candidate(2, { monday: [] }),
      candidate(3, { monday: [{ opens: null, closes: "17:00", closed: false }] }),
    ],
    [1, 2, 3].map((rank) => candidate(rank, { monday: open("00:00", "00:00") })),
  ]) {
    const trip = createTripFromPlaces(late, inventory, "2028-02-28");
    expect(trip.stops.map((stop) => stop.startTime)).toEqual(["11:00", "15:00", "20:00"]);
  }
});

test("known split and overnight windows use only listed same-date time within the rhythm bounds", () => {
  const split = candidate(1, { monday: [...open("11:00", "11:30"), ...open("16:15", "17:15")] });
  const night = candidate(2, { monday: open("22:00", "02:00") });
  const trip = createTripFromPlaces(late, [split, night], "2028-02-28");
  expect(trip.stops.map((stop) => stop.startTime)).toEqual(["16:15", "22:00"]);
  expect(
    createTripFromPlaces(
      {
        ...late,
        tasteProfile: { seeds: [], dayStyle: "Culture", categories: ["culture"], rhythm: "early" },
      },
      [night],
      "2028-02-28",
    ).stops,
  ).toEqual([]);
});

test("automatic city fill preserves accepted/pinned/manual visits, query evidence, city binding and Undo", () => {
  const empty = createTripFromPlaces({ ...late, days: 2 }, []);
  const manual = candidate(40, { monday: closed });
  manual.taste = { queryId: "synthetic-original-manual-query", rank: 40 };
  const trip = accepted(
    applyTripCommand(empty, {
      id: "synthetic-reviewed-existing",
      baseVersion: empty.version,
      operations: [
        {
          type: "set-route",
          route: {
            startDate: "2028-02-28",
            stays: [
              { id: "lisbon", destinationId: "lisbon", days: 2 },
              { id: "porto", destinationId: "porto", days: 1 },
            ],
            transfers: [{ id: "transfer", fromStayId: "lisbon", toStayId: "porto", mode: "train" }],
          },
        },
        { type: "add-candidates", destinationId: "lisbon", places: [manual] },
        {
          type: "add-stop",
          stop: {
            id: "synthetic-pinned-manual",
            placeId: manual.id,
            dayId: "day-1",
            startTime: "20:00",
            durationMinutes: 60,
            pinned: true,
            timeLocked: true,
          },
        },
      ],
    }),
  ).trip;
  const inventory = [
    candidate(1, { monday: closed, tuesday: open("11:30", "12:30") }),
    candidate(2, { monday: closed, tuesday: closed, wednesday: open("11:00", "17:00") }),
    candidate(3),
  ];
  const before = structuredClone(trip);
  const operations = cityRecommendationOperations(trip, "lisbon", inventory);
  expect(trip).toEqual(before);
  const result = accepted(
    applyTripCommand(trip, { id: "synthetic-fill-hours", baseVersion: trip.version, operations }),
  );
  expect(result.trip.stops.find((stop) => stop.id === "synthetic-pinned-manual")).toEqual(
    trip.stops[0],
  );
  const placed = result.trip.stops.filter((stop) => stop.id !== "synthetic-pinned-manual");
  const [first, , third] = inventory;
  if (!first || !third) throw new Error("Missing synthetic city candidates");
  expect(placed.map((stop) => [stop.placeId, stop.dayId, stop.startTime])).toEqual([
    [third.id, "day-1", "11:00"],
    [first.id, "day-2", "11:30"],
  ]);
  expect(placed.every((stop) => stop.selection?.queryId === "synthetic-listed-hours-query")).toBe(
    true,
  );
  expect(placed.map((stop) => stop.selection?.rank)).toEqual([3, 1]);
  expect(result.trip.places.some((place) => place.id === inventory[1]?.id)).toBe(true);
  expect(
    accepted(undoTripCommand(result.trip, result.receipt, "synthetic-undo-hours")).trip.stops,
  ).toEqual(trip.stops);
  expect(validateTrip(result.trip)).toEqual([]);
});
