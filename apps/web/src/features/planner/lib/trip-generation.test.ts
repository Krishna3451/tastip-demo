import { expect, test } from "bun:test";
import {
  DEFAULT_BRIEF,
  dayFactWarnings,
  destinationForDay,
  type Place,
  parseStoredTrip,
  type TripBrief,
  type TripRoute,
  validateTrip,
} from "@tastip/domain";
import { buildPrimaryTripPreview, buildTripPreview } from "./trip-generation";

const brief: TripBrief = {
  ...DEFAULT_BRIEF,
  days: 4,
  tasteProfile: {
    seeds: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Fixture film",
        type: "urn:entity:movie",
      },
    ],
    dayStyle: "Quiet culture",
    categories: ["culture"],
    rhythm: "late",
  },
};
function route(startDate: string | null): TripRoute {
  return {
    startDate,
    stays: [
      { id: "first-stay", destinationId: "lisbon", days: 2 },
      { id: "second-stay", destinationId: "porto", days: 2 },
    ],
    transfers: [
      {
        id: "between-cities",
        fromStayId: "first-stay",
        toStayId: "second-stay",
        mode: "undecided",
      },
    ],
  };
}
function places(destinationId: string): Place[] {
  return [9, 2, 7, 4, 12].map((rank) => ({
    id: `${destinationId}-fixture-${rank}`,
    destinationId,
    name: `${destinationId} fixture ${rank}`,
    description: "Synthetic generation fixture; not a live venue.",
    category: "culture",
    lat: destinationId === "lisbon" ? 38.72 : 41.15,
    lng: destinationId === "lisbon" ? -9.13 : -8.62,
    source: "qloo",
    taste: { queryId: `${destinationId}-query`, rank, score: rank / 20 },
    practical: { hours: "unknown", cost: "unknown" },
  }));
}

test("primary rebuild checks entered transfers before choosing listed-hour times", () => {
  const itinerary: TripRoute = {
    startDate: "2028-02-28",
    stays: [
      { id: "lisbon", destinationId: "lisbon", days: 1 },
      { id: "porto", destinationId: "porto", days: 1 },
    ],
    transfers: [
      {
        id: "entered",
        fromStayId: "lisbon",
        toStayId: "porto",
        mode: "train",
        timing: {
          source: "traveler",
          departure: { date: "2028-02-28", time: "15:00" },
          arrival: { date: "2028-02-29", time: "10:00" },
        },
      },
    ],
  };
  const first = places("lisbon")[0];
  if (!first) throw new Error("Missing synthetic museum fixture");
  const museum: Place = {
    ...first,
    facts: {
      source: "qloo",
      retrievedAt: "2026-10-30T00:00:00Z",
      hours: { monday: [{ opens: "16:00", closes: "18:00", closed: false }] },
    },
  };
  const before = structuredClone({ brief, itinerary, museum });
  const preview = buildPrimaryTripPreview(brief, [museum], itinerary);
  expect(preview.route).toEqual(itinerary);
  expect(preview.stops).toEqual([]);
  expect(preview.places[0]?.taste).toEqual(museum.taste);
  expect(validateTrip(preview)).toEqual([]);
  expect(parseStoredTrip(preview)).toEqual(preview);
  expect({ brief, itinerary, museum }).toEqual(before);

  // Complete windows may choose a legal earlier time; unknown hours keep the original slots.
  if (!museum.facts) throw new Error("Missing synthetic museum hours");
  const flexible = {
    ...museum,
    facts: {
      ...museum.facts,
      hours: {
        monday: [{ opens: "13:00", closes: "18:00", closed: false }],
      },
    },
  };
  const fitted = buildPrimaryTripPreview(brief, [flexible], itinerary);
  expect(fitted.stops.map((stop) => stop.startTime)).toEqual(["13:00"]);
  expect(fitted.stops[0]?.selection).toEqual(museum.taste);
  const unknown = buildPrimaryTripPreview(brief, places("lisbon"), itinerary);
  expect(unknown.stops.map((stop) => stop.startTime)).toEqual(["11:00"]);
  expect(unknown.places).toHaveLength(5);
  const undatedRoute = route(null);
  const previousPattern = buildPrimaryTripPreview(brief, places("lisbon"), undatedRoute);
  expect(
    previousPattern.stops.filter((stop) => stop.dayId === "day-1").map((stop) => stop.startTime),
  ).toEqual(["11:00", "15:00", "20:00"]);
  expect(validateTrip(fitted)).toEqual([]);
  expect(validateTrip(unknown)).toEqual([]);
});

for (const startDate of [null, "2027-03-28"]) {
  test(`a reviewed multi-city draft preserves local query evidence and all ${startDate ? "dated" : "flexible"} days without changing its inputs`, () => {
    const itinerary = route(startDate);
    const groups = [
      { destinationId: "lisbon", places: places("lisbon") },
      { destinationId: "porto", places: places("porto") },
    ];
    const original = structuredClone({ brief, itinerary, groups });
    const preview = buildTripPreview(brief, itinerary, groups);
    expect({ brief, itinerary, groups }).toEqual(original);
    expect(preview.route).toEqual(itinerary);
    expect(preview.brief.days).toBe(4);
    expect(preview.days.map((day) => day.date)).toEqual(
      startDate
        ? ["2027-03-28", "2027-03-29", "2027-03-30", "2027-03-31"]
        : [null, null, null, null],
    );
    expect(preview.places).toHaveLength(10);
    expect(preview.stops).toHaveLength(10);
    for (const group of groups) {
      const cityStops = preview.stops.filter(
        (stop) => destinationForDay(preview, stop.dayId) === group.destinationId,
      );
      expect(cityStops.map((stop) => stop.selection?.rank)).toEqual([2, 4, 7, 9, 12]);
      for (const stop of cityStops) {
        const candidate = group.places.find((place) => place.id === stop.placeId);
        expect(stop.selection).toEqual(candidate?.taste);
        expect(preview.places.find((place) => place.id === stop.placeId)?.taste).toEqual(
          candidate?.taste,
        );
      }
    }
    expect(preview.stops.find((stop) => stop.dayId === "day-1")?.startTime).toBe("11:00");
    expect(preview.stops.find((stop) => stop.dayId === "day-3")?.startTime).toBe("15:00");
    expect(parseStoredTrip(JSON.parse(JSON.stringify(preview)))).toEqual(preview);
    // The returned draft owns its data; editing it cannot rewrite the source candidates.
    const first = preview.places[0];
    if (!first) throw new Error("Missing fixture candidate");
    first.name = "Locally changed preview";
    expect(groups).toEqual(original.groups);
  });
}

test("dated reviewed generation uses each city's actual weekday hours and retains unscheduled Ideas", () => {
  const lisbon = places("lisbon").map((place) => ({
    ...place,
    facts: {
      source: "qloo" as const,
      retrievedAt: "2026-10-30T00:00:00Z",
      hours: {
        monday: [{ opens: null, closes: null, closed: true }],
        tuesday: [{ opens: "11:30", closes: "17:00", closed: false }],
      },
    },
  }));
  const porto = places("porto").map((place) => ({
    ...place,
    facts: {
      source: "qloo" as const,
      retrievedAt: "2026-10-30T00:00:00Z",
      hours: {
        wednesday: [{ opens: "11:00", closes: "14:00", closed: false }],
        thursday: [{ opens: null, closes: null, closed: true }],
      },
    },
  }));
  const preview = buildTripPreview(brief, route("2028-02-28"), [
    { destinationId: "lisbon", places: lisbon },
    { destinationId: "porto", places: porto },
  ]);
  expect(preview.stops.map((stop) => [stop.dayId, stop.startTime])).toEqual([
    ["day-2", "11:30"],
    ["day-2", "14:00"],
    ["day-2", "16:00"],
  ]);
  // Porto arrival's existing 15:00 draft bound cannot fit its listed 14:00 closing.
  expect(preview.places).toHaveLength(10);
  expect(preview.days.flatMap((day) => dayFactWarnings(preview, day.id))).toEqual([]);
  expect(preview.stops.map((stop) => stop.selection?.rank)).toEqual([2, 4, 7]);
  expect(parseStoredTrip(preview)).toEqual(preview);
});

test("generation rejects mixed queries, foreign cities, duplicate groups and non-Qloo candidates without rewriting input", () => {
  const candidates = places("lisbon");
  const original = structuredClone(candidates);
  const mixed = candidates.map((place, index) =>
    index === 0 ? { ...place, taste: { ...place.taste!, queryId: "unrelated-query" } } : place,
  );
  expect(() =>
    buildTripPreview(brief, route(null), [{ destinationId: "lisbon", places: mixed }]),
  ).toThrow("one Qloo query");
  expect(() =>
    buildTripPreview(brief, route(null), [{ destinationId: "kyoto", places: [] }]),
  ).toThrow("outside the reviewed route");
  expect(() =>
    buildTripPreview(brief, route(null), [
      { destinationId: "lisbon", places: candidates },
      { destinationId: "lisbon", places: [] },
    ]),
  ).toThrow("one recommendation group per city");
  expect(() =>
    buildTripPreview(brief, route(null), [{ destinationId: "porto", places: candidates }]),
  ).toThrow("different city than its group");
  expect(() =>
    buildTripPreview(brief, route(null), [
      {
        destinationId: "lisbon",
        places: [{ ...candidates[0]!, source: "demo", taste: undefined }],
      },
    ]),
  ).toThrow("Only Qloo candidates");
  expect(() =>
    buildTripPreview(brief, route(null), [
      { destinationId: "lisbon", places: [{ ...candidates[0]!, taste: undefined }] },
    ]),
  ).toThrow("original recommendation evidence");
  expect(candidates).toEqual(original);
});

test("missing or empty city coverage keeps every reviewed day without inventing visits", () => {
  for (const groups of [
    [],
    [
      { destinationId: "lisbon", places: [] },
      { destinationId: "porto", places: [] },
    ],
  ]) {
    const preview = buildTripPreview(brief, route(null), groups);
    expect(preview.days).toHaveLength(4);
    expect(preview.days.every((day) => day.date === null)).toBe(true);
    expect(preview.places).toEqual([]);
    expect(preview.stops).toEqual([]);
    expect(parseStoredTrip(preview)).not.toBeNull();
  }
});

test("invalid routes and invalid provider records fail before a preview can be accepted", () => {
  expect(() => buildTripPreview(brief, { ...route(null), transfers: [] }, [])).toThrow(
    "cities, days and dates",
  );
  expect(() => buildTripPreview({ ...brief, destinationId: "porto" }, route(null), [])).toThrow(
    "first city",
  );
  const candidates = places("lisbon");
  const invalid = [{ ...candidates[0]!, lat: Number.NaN }];
  expect(() =>
    buildTripPreview(brief, route(null), [{ destinationId: "lisbon", places: invalid }]),
  ).toThrow("could not be validated");
  const duplicateRank = [
    { ...candidates[0]! },
    { ...candidates[1]!, taste: { ...candidates[0]!.taste! } },
  ];
  expect(() =>
    buildTripPreview(brief, route(null), [{ destinationId: "lisbon", places: duplicateRank }]),
  ).toThrow("could not be validated");
});
