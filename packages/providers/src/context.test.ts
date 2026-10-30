import { expect, test } from "bun:test";
import type { TripContextInput } from "./context";
import { projectTripContext, projectTripContextInput } from "./context";

function fixture(): TripContextInput {
  const paris = {
    id: "fixture-paris",
    name: "Paris",
    country: "France",
    lat: 48.85,
    lng: 2.35,
    timeZone: "Europe/Paris",
  };
  const lyon = { ...paris, id: "fixture-lyon", name: "Lyon", lat: 45.76, lng: 4.84 };
  return {
    id: "synthetic-context",
    version: 7,
    brief: {
      destinationId: paris.id,
      destination: paris,
      days: 3,
      partySize: 2,
      origin: "Delhi",
      budget: 0,
      currency: "EUR",
      pace: "slow",
      interests: ["Culture"],
      tasteProfile: {
        seeds: [{ id: "seed", name: "Synthetic favorite", type: "artist" }],
        dayStyle: "Creative spaces",
        categories: ["culture"],
        rhythm: "late",
        dietary: ["Vegetarian"],
        walking: "short",
        lodging: "Boutique",
      },
    },
    days: [
      { id: "day-1", label: "Day 1", date: "2028-02-28" },
      { id: "day-2", label: "Day 2", date: "2028-02-29" },
      { id: "day-3", label: "Day 3", date: "2028-03-01" },
    ],
    route: {
      startDate: "2028-02-28",
      stays: [
        { id: "a", destinationId: paris.id, destination: paris, days: 2 },
        { id: "b", destinationId: lyon.id, destination: lyon, days: 1 },
      ],
      transfers: [
        {
          id: "ab",
          fromStayId: "a",
          toStayId: "b",
          mode: "train",
          timing: {
            source: "traveler",
            departure: { date: "2028-03-01", time: "08:00", utcOffset: "+01:00" },
            arrival: { date: "2028-03-01", time: "11:00", utcOffset: "+01:00" },
          },
        },
      ],
    },
    lodgings: [{ stayId: "a", name: "Synthetic lodging idea", destinationId: paris.id }],
    places: [
      { id: "sample", name: "Synthetic demo", source: "demo" },
      { id: "qloo", name: "Synthetic Qloo", source: "qloo" },
      { id: "own", name: "Synthetic traveler pin", source: "traveler" },
    ],
    stops: ["sample", "qloo", "own"].map((id, index) => ({
      id: `visit-${id}`,
      placeId: id,
      dayId: `day-${index + 1}`,
      startTime: "13:00",
      durationMinutes: 45,
      pinned: index === 1,
      timeLocked: index === 2,
    })),
  };
}

function addPrivateMetadata(input: TripContextInput) {
  const privateData = { privateExtension: { secret: "SYNTHETIC_PRIVATE_METADATA" } };
  const annotate = (record: object | undefined) => {
    if (record) Object.assign(record, privateData);
  };
  annotate(input);
  annotate(input.brief);
  annotate(input.brief.destination);
  annotate(input.brief.tasteProfile);
  input.brief.tasteProfile?.seeds.forEach(annotate);
  annotate(input.route);
  input.route?.stays.forEach((stay) => {
    annotate(stay);
    annotate(stay.destination);
  });
  input.route?.transfers.forEach((transfer) => {
    annotate(transfer);
    annotate(transfer.timing);
    annotate(transfer.timing?.departure);
    annotate(transfer.timing?.arrival);
  });
  input.days?.forEach(annotate);
  input.places.forEach(annotate);
  input.stops.forEach(annotate);
  input.lodgings?.forEach(annotate);
  Object.assign(input.brief, { details: { request: "SYNTHETIC_PRIVATE_REQUEST" } });
  Object.assign(input.days![0]!, { note: "SYNTHETIC_PRIVATE_DAY_NOTE" });
  Object.assign(input.stops[0]!, { note: "SYNTHETIC_PRIVATE_VISIT_NOTE" });
}

test("request and live context project every nested imported record without private extensions", () => {
  const clean = fixture();
  const imported = fixture();
  addPrivateMetadata(imported);
  const before = structuredClone(imported);
  const request = projectTripContextInput(imported);
  const live = projectTripContext(imported);
  expect(request).toEqual(projectTripContextInput(clean));
  expect(live).toEqual(projectTripContext(clean));
  expect(JSON.stringify(request)).not.toContain("SYNTHETIC_PRIVATE");
  expect(JSON.stringify(live)).not.toContain("SYNTHETIC_PRIVATE");
  expect(imported).toEqual(before);
  // Neither projection shares mutable nested references with accepted domain data.
  request.brief.destination!.name = "Changed projected city";
  request.route!.transfers[0]!.timing!.departure.time = "09:00";
  live!.tasteProfile!.seeds[0]!.name = "Changed projected seed";
  expect(imported).toEqual(before);
});

test("safe context retains city/timezone, traveler timing, taste and canonical visit/source semantics", () => {
  const input = fixture();
  const result = projectTripContext(input)!;
  expect(result).toMatchObject({ tripId: input.id, version: 7, budget: 0, origin: "Delhi" });
  expect(result.destination).toEqual(input.brief.destination);
  expect(result.tasteProfile).toEqual(input.brief.tasteProfile);
  expect(result.calendar?.[2]).toEqual({
    id: "day-3",
    date: "2028-03-01",
    city: "Lyon",
    timeZone: "Europe/Paris",
  });
  expect(result.transfers).toEqual([
    {
      date: "2028-03-01",
      from: "Paris",
      to: "Lyon",
      mode: "train",
      verified: false,
      timing: {
        ...input.route!.transfers[0]!.timing!,
        departureTimeZone: "Europe/Paris",
        arrivalTimeZone: "Europe/Paris",
      },
    },
  ]);
  expect(result.lodgings).toEqual([
    {
      name: "Synthetic lodging idea",
      city: "Paris",
      arrival: "2028-02-28",
      departure: "2028-03-01",
      status: "idea",
    },
  ]);
  expect(
    result.stops.map(({ id, source, sample, pinned, timeLocked }) => ({
      id,
      source,
      sample,
      pinned,
      timeLocked,
    })),
  ).toEqual([
    { id: "visit-sample", source: "demo", sample: true, pinned: false, timeLocked: false },
    { id: "visit-qloo", source: "qloo", sample: false, pinned: true, timeLocked: false },
    { id: "visit-own", source: "traveler", sample: false, pinned: false, timeLocked: true },
  ]);
  expect(result.stops[1]).toMatchObject({
    placeId: "qloo",
    name: "Synthetic Qloo",
    day: "day-2",
    time: "13:00",
    durationMinutes: 45,
  });
});

test("context cardinalities stay bounded and missing plans do not fabricate context", () => {
  const input = fixture();
  input.days = Array.from({ length: 200 }, (_, n) => ({
    id: `day-${n}`,
    label: "Synthetic day",
    date: null,
  }));
  input.places = Array.from({ length: 200 }, (_, n) => ({
    id: `place-${n}`,
    name: "Synthetic place",
    source: "demo",
  }));
  input.stops = Array.from({ length: 200 }, (_, n) => ({
    id: `stop-${n}`,
    placeId: `place-${n}`,
    dayId: "day-1",
    startTime: "13:00",
  }));
  const result = projectTripContext(input)!;
  expect(result.calendar).toHaveLength(30);
  expect(result.places).toHaveLength(150);
  expect(result.stops).toHaveLength(150);
  expect(projectTripContext(undefined)).toBeUndefined();
});
