import { expect, test } from "bun:test";
import { applyTripCommand, createDemoTrip, DEFAULT_BRIEF } from "@tastip/domain";
import { tripProviderContext, tripRequestContext } from "../lib/trip-context";
import { toProviderContext, tripContextSchema } from "./context";

test("traveler pins reach conversation with their own source and no fictional or Qloo attribution", () => {
  const before = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const result = applyTripCommand(before, {
    id: "context-pin",
    baseVersion: 1,
    operations: [
      {
        type: "set-own-place",
        place: {
          id: "traveler:context-pin",
          name: "Own pin fixture",
          destinationId: "lisbon",
          description: "User-entered pin",
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
          id: "pin-visit",
          placeId: "traveler:context-pin",
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
  const context = toProviderContext(tripContextSchema.parse(tripRequestContext(result.trip)));
  expect(context?.stops.find((stop) => stop.id === "pin-visit")).toMatchObject({
    name: "Own pin fixture",
    source: "traveler",
    sample: false,
  });
  expect(context?.stops[0]?.sample).toBe(true);
});

test("conversation sees a traveler lodging idea without its private address or link", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  const result = applyTripCommand(before, {
    id: "context-own-lodging",
    baseVersion: 1,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: "2028-02-28",
          stays: [{ id: "a", destinationId: "lisbon", days: 3 }],
          transfers: [],
        },
      },
      {
        type: "select-lodging",
        stayId: "a",
        candidate: {
          id: "own-stay",
          name: "Traveler lodging fixture",
          source: "traveler",
          destinationId: "lisbon",
          address: "Private lodging address",
          website: "https://example.test/private-booking",
        },
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  const snapshot = tripRequestContext(result.trip);
  const context = toProviderContext(tripContextSchema.parse(snapshot));
  expect(context?.lodgings).toEqual([
    {
      name: "Traveler lodging fixture",
      city: "Lisbon",
      arrival: "2028-02-28",
      departure: "2028-03-01",
      status: "idea",
    },
  ]);
  expect(JSON.stringify(snapshot)).not.toContain("Private lodging address");
  expect(JSON.stringify(snapshot)).not.toContain("private-booking");
  expect(JSON.stringify(context)).not.toContain("Private lodging address");
  expect(JSON.stringify(context)).not.toContain("private-booking");
});

test("a thirty-day conversation snapshot retains the final canonical day without repeating places", () => {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 30 });
  const context = toProviderContext(tripContextSchema.parse(tripRequestContext(trip)));
  expect(context?.calendar).toHaveLength(30);
  expect(context?.calendar?.[29]?.id).toBe("day-30");
  expect(context?.stops).toHaveLength(8);
});

test("conversation payload stays bounded after edits and excludes undo history", () => {
  let trip = createDemoTrip({ ...DEFAULT_BRIEF, budget: 0, origin: "Delhi" });
  trip.stops[0]!.note = "Private visit reminder";
  trip.days[0]!.note = "Private day reminder";
  trip.costs = [
    {
      id: "private-cost",
      label: "Private planning amount",
      category: "activity",
      currency: "EUR",
      unitAmountMinor: 12345,
      quantity: 1,
      appliesTo: "party",
      source: "traveler",
    },
  ];
  for (let index = 0; index < 30; index++) {
    const result = applyTripCommand(trip, {
      id: `context-test-${index}`,
      baseVersion: trip.version,
      operations: [{ type: "pin-stop", stopId: "day-1-stop-1", pinned: index % 2 === 0 }],
    });
    if (!result.ok) throw new Error(result.error.message);
    trip = result.trip;
  }
  expect(JSON.stringify(trip).length).toBeGreaterThan(64 * 1024);
  const snapshot = tripRequestContext(trip);
  expect(JSON.stringify(snapshot).length).toBeLessThan(10 * 1024);
  expect(JSON.stringify(snapshot)).not.toContain("commandLog");
  expect(JSON.stringify(snapshot)).not.toContain("Private visit reminder");
  expect(JSON.stringify(snapshot)).not.toContain("Private day reminder");
  expect(JSON.stringify(snapshot)).not.toContain("Private planning amount");
  const context = toProviderContext(tripContextSchema.parse(snapshot));
  expect(context?.budget).toBe(0);
  expect(context?.origin).toBe("Delhi");
  expect(context?.version).toBe(trip.version);
  expect(JSON.stringify(context)).not.toContain("12345");
  expect(JSON.stringify(context)).not.toContain("Private visit reminder");
  expect(JSON.stringify(context)).not.toContain("Private day reminder");
});

test("conversation receives dated city stays and explicitly unverified transfers", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  const result = applyTripCommand(before, {
    id: "route-context",
    baseVersion: before.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: "2028-02-28",
          stays: [
            { id: "a", destinationId: "lisbon", days: 3 },
            { id: "b", destinationId: "porto", days: 2 },
          ],
          transfers: [{ id: "ab", fromStayId: "a", toStayId: "b", mode: "train" }],
        },
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  const context = toProviderContext(tripContextSchema.parse(tripRequestContext(result.trip)));
  expect(context?.calendar?.[3]).toEqual({
    id: "day-4",
    date: "2028-03-02",
    city: "Porto",
    timeZone: "Europe/Lisbon",
  });
  expect(context?.transfers).toEqual([
    { date: "2028-03-02", from: "Lisbon", to: "Porto", mode: "train", verified: false },
  ]);
  expect(JSON.stringify(context)).not.toContain("commandLog");
  result.trip.route!.transfers[0]!.timing = {
    source: "traveler",
    departure: { date: "2028-03-02", time: "09:00" },
    arrival: { date: "2028-03-02", time: "12:00" },
  };
  const timed = toProviderContext(tripContextSchema.parse(tripRequestContext(result.trip)));
  expect(timed?.transfers?.[0]?.verified).toBe(false);
  expect(timed?.transfers?.[0]?.timing).toEqual({
    ...result.trip.route!.transfers[0]!.timing,
    departureTimeZone: "Europe/Lisbon",
    arrivalTimeZone: "Europe/Lisbon",
  });
});

test("conversation resolves embedded geocoded city names and local timezones", () => {
  const paris = {
    id: "fixture-paris",
    name: "Paris",
    country: "France",
    lat: 48.85,
    lng: 2.35,
    timeZone: "Europe/Paris",
  };
  const lyon = {
    id: "fixture-lyon",
    name: "Lyon",
    country: "France",
    lat: 45.76,
    lng: 4.84,
    timeZone: "Europe/Paris",
  };
  const body = tripContextSchema.parse({
    id: "trip-custom",
    version: 1,
    brief: { ...DEFAULT_BRIEF, destinationId: paris.id, destination: paris, days: 2 },
    days: [
      { id: "day-1", label: "Day 1", date: "2028-06-01" },
      { id: "day-2", label: "Day 2", date: "2028-06-02" },
    ],
    route: {
      startDate: "2028-06-01",
      stays: [
        { id: "a", destinationId: paris.id, destination: paris, days: 1 },
        { id: "b", destinationId: lyon.id, destination: lyon, days: 1 },
      ],
      transfers: [{ id: "ab", fromStayId: "a", toStayId: "b", mode: "train" }],
    },
    places: [],
    stops: [],
  });
  const context = toProviderContext(body);
  expect(context?.calendar?.map((day) => day.city)).toEqual(["Paris", "Lyon"]);
  expect(context?.transfers?.[0]).toMatchObject({ from: "Paris", to: "Lyon", verified: false });
});

test("confirmed taste answers reach chat as preferences, without provider payloads or receipt history", () => {
  const trip = createDemoTrip({
    ...DEFAULT_BRIEF,
    tasteProfile: {
      seeds: [{ id: "fixture-seed", name: "Fixture Artist", type: "urn:entity:artist" }],
      dayStyle: "Creative spaces",
      categories: ["culture"],
      rhythm: "late",
      dietary: ["Vegetarian"],
      walking: "short",
      lodging: "Boutique & character",
    },
  });
  const context = toProviderContext(tripContextSchema.parse(tripRequestContext(trip)));
  expect(context?.tasteProfile?.rhythm).toBe("late");
  expect(context?.tasteProfile?.dietary).toEqual(["Vegetarian"]);
  expect(JSON.stringify(context)).not.toContain("commandLog");
});

test("flexible route context preserves unknown lodging and transfer dates", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  const result = applyTripCommand(before, {
    id: "flex-context",
    baseVersion: before.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: null,
          stays: [
            { id: "lisbon", destinationId: "lisbon", days: 3 },
            { id: "porto", destinationId: "porto", days: 2 },
          ],
          transfers: [
            { id: "transfer", fromStayId: "lisbon", toStayId: "porto", mode: "undecided" },
          ],
        },
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  const context = toProviderContext(tripContextSchema.parse(tripRequestContext(result.trip)));
  expect(context?.calendar?.every((day) => day.date === null)).toBe(true);
  expect(context?.calendar?.at(-1)?.city).toBe("Porto");
  expect(context?.transfers?.[0]).toMatchObject({
    date: null,
    from: "Lisbon",
    to: "Porto",
    mode: "undecided",
    verified: false,
  });
});

test("initial session and live updates use the same private-metadata-free provider contract", () => {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const city = {
    id: "synthetic-paris",
    name: "Paris",
    country: "France",
    lat: 48.85,
    lng: 2.35,
    timeZone: "Europe/Paris",
    privateImport: "SYNTHETIC_PRIVATE_CITY",
  };
  trip.brief.destinationId = city.id;
  trip.brief.destination = city;
  trip.route = {
    startDate: null,
    stays: [{ id: "a", destinationId: city.id, destination: city, days: 1 }],
    transfers: [],
  };
  Object.assign(trip.brief, { details: { request: "SYNTHETIC_PRIVATE_BRIEF" } });
  trip.days[0]!.note = "SYNTHETIC_PRIVATE_DAY";
  trip.stops[0]!.note = "SYNTHETIC_PRIVATE_STOP";
  Object.assign(trip.route, { privateImport: "SYNTHETIC_PRIVATE_ROUTE" });
  const snapshot = tripRequestContext(trip);
  const initial = toProviderContext(tripContextSchema.parse(snapshot));
  expect(tripProviderContext(trip)).toEqual(initial);
  expect(JSON.stringify(snapshot)).not.toContain("SYNTHETIC_PRIVATE");
  expect(JSON.stringify(initial)).not.toContain("SYNTHETIC_PRIVATE");
  // A directly posted custom city also crosses the server's custom-validator boundary safely.
  const direct = toProviderContext(
    tripContextSchema.parse({ ...snapshot, brief: { ...snapshot!.brief, destination: city } }),
  );
  expect(JSON.stringify(direct)).not.toContain("SYNTHETIC_PRIVATE");
  expect(direct?.calendar?.[0]).toMatchObject({ city: "Paris", timeZone: "Europe/Paris" });
  expect(trip.brief.destination).toHaveProperty("privateImport");
  expect(trip.days[0]!.note).toBe("SYNTHETIC_PRIVATE_DAY");
});
