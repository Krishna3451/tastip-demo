import { expect, test } from "bun:test";
import { applyTripCommand, createDemoTrip, DEFAULT_BRIEF, type Place } from "@tastip/domain";
import { betweenPlacesUrl, drivingRouteConflicts, realDayVisits } from "./day-directions";

test("traveler pins appear on the map and directions while fictional sample coordinates stay excluded", () => {
  const before = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const result = applyTripCommand(before, {
    id: "map-own-pin",
    baseVersion: 1,
    operations: [
      {
        type: "set-own-place",
        place: {
          id: "traveler:map",
          name: "Own map pin",
          destinationId: "lisbon",
          description: "User-entered point",
          category: "outdoors",
          source: "traveler",
          lat: 38.72,
          lng: -9.14,
          practical: { hours: "unknown", cost: "unknown" },
        },
      },
      {
        type: "add-stop",
        stop: {
          id: "own-map-visit",
          placeId: "traveler:map",
          dayId: "day-1",
          startTime: "15:30",
          durationMinutes: 60,
          pinned: false,
          timeLocked: false,
        },
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(realDayVisits(result.trip, "day-1").map((item) => item.stopId)).toEqual(["own-map-visit"]);
});

function mixedTrip() {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const demo = trip.stops[0]!;
  const places: Place[] = [1, 2].map((rank) => ({
    ...trip.places[0]!,
    id: `real-fixture-${rank}`,
    name: `Synthetic real-place record ${rank}`,
    source: "qloo",
    taste: { queryId: "synthetic-mixed-day", rank },
  }));
  trip.places.push(...places);
  trip.stops = [
    { ...demo, startTime: "07:30" },
    { ...demo, id: "real-visit-1", placeId: places[0]!.id, startTime: "09:30" },
    { ...demo, id: "real-visit-2", placeId: places[1]!.id, startTime: "10:45" },
  ];
  return trip;
}

test("directions use encoded coordinates and an explicit supported mode, without sending trip data", () => {
  for (const mode of ["walking", "transit", "driving"] as const) {
    const url = new URL(
      betweenPlacesUrl({ lat: 38.72, lng: -9.13 }, { lat: 38.73, lng: -9.14 }, mode),
    );
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api: "1",
      origin: "38.72,-9.13",
      destination: "38.73,-9.14",
      travelmode: mode,
    });
  }
  expect(() => betweenPlacesUrl({ lat: 91, lng: 0 }, { lat: 0, lng: 0 }, "walking")).toThrow(
    "invalid",
  );
});

test("driving warnings compare actual real-visit identities even when sample visits precede them", () => {
  const trip = mixedTrip();
  expect(realDayVisits(trip, "day-1").map((item) => item.stopId)).toEqual([
    "real-visit-1",
    "real-visit-2",
  ]);
  const warnings = drivingRouteConflicts(trip, "day-1", {
    legs: [{ durationSeconds: 1800, distanceMetres: 1000 }],
  });
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("your gap is 15 minutes");
  expect(warnings[0]).toContain("Synthetic real-place record 1");
  trip.stops[0]!.startTime = "10:30";
  trip.stops[0]!.durationMinutes = 5;
  expect(
    drivingRouteConflicts(trip, "day-1", {
      legs: [{ durationSeconds: 1800, distanceMetres: 1000 }],
    }),
  ).toEqual([]);
});

test("dated driving gaps use elapsed time across clock changes", () => {
  const trip = mixedTrip();
  trip.days[0]!.date = "2028-03-26";
  trip.stops = trip.stops.slice(1);
  trip.stops[0]!.startTime = "00:30";
  trip.stops[1]!.startTime = "02:00";
  // Lisbon skips 01:00–02:00. These wall clocks are only 30 real minutes apart.
  const warnings = drivingRouteConflicts(trip, "day-1", {
    legs: [{ durationSeconds: 600, distanceMetres: 500 }],
  });
  expect(warnings[0]).toContain("your gap is -30 minutes");
});
