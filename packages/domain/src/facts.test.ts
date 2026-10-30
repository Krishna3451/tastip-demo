import { expect, test } from "bun:test";
import { dayFactWarnings, listedHoursWarning, validPlaceFacts } from "./facts";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { parseStoredTrip } from "./storage";

test("provider hours produce advisory conflicts on the actual local calendar weekday", () => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  trip.days[0]!.date = "2028-02-28"; // Monday
  const place = trip.places[0]!;
  place.source = "qloo";
  place.taste = { queryId: "fixture-query", rank: 3 };
  place.facts = {
    source: "qloo",
    retrievedAt: "2026-10-29T00:00:00Z",
    hours: { monday: [{ opens: "11:00", closes: "18:00", closed: false }] },
  };
  expect(dayFactWarnings(trip, "day-1")[0]?.message).toContain("outside Qloo");
  trip.stops[0]!.startTime = "11:00";
  expect(dayFactWarnings(trip, "day-1")).toEqual([]);
  place.facts.hours!.monday = [{ opens: null, closes: null, closed: true }];
  expect(dayFactWarnings(trip, "day-1")[0]?.message).toContain("lists this weekday as closed");
  expect(parseStoredTrip(trip)?.places[0]?.facts).toEqual(place.facts);
  expect(validPlaceFacts({ ...place.facts, website: "javascript:alert(1)" })).toBe(false);
});

test("listed-hour review distinguishes closed and outside intervals without mutating place facts", () => {
  const place = createDemoTrip(DEFAULT_BRIEF).places[0]!;
  place.source = "qloo";
  place.facts = {
    source: "qloo",
    retrievedAt: "2026-10-29T00:00:00Z",
    hours: { monday: [{ opens: "11:00", closes: "13:00", closed: false }] },
  };
  const before = structuredClone(place);
  expect(listedHoursWarning(place, "2028-02-28", "09:30", 60)?.kind).toBe("outside");
  expect(listedHoursWarning(place, "2028-02-28", "12:30", 60)?.kind).toBe("outside");
  expect(listedHoursWarning(place, "2028-02-28", "11:00", 120)).toBeNull();
  expect(listedHoursWarning(place, "2028-02-28", "12:00", 60)).toBeNull();
  expect(place).toEqual(before);
  place.facts.hours!.monday = [{ opens: null, closes: null, closed: true }];
  expect(listedHoursWarning(place, "2028-02-28", "11:00", 60)?.kind).toBe("closed");
});

test("listed-hour review leaves unknown, incomplete, overnight and invalid intervals unasserted", () => {
  const place = createDemoTrip(DEFAULT_BRIEF).places[0]!;
  place.source = "qloo";
  place.facts = {
    source: "qloo",
    retrievedAt: "2026-10-29T00:00:00Z",
    hours: { monday: [{ opens: "11:00", closes: "13:00", closed: false }] },
  };
  expect(listedHoursWarning(place, null, "09:30", 60)).toBeNull();
  expect(listedHoursWarning(place, "2028-02-29", "09:30", 60)).toBeNull();
  expect(listedHoursWarning(place, "2028-02-28", "", 60)).toBeNull();
  expect(listedHoursWarning(place, "2028-02-28", "25:00", 60)).toBeNull();
  expect(listedHoursWarning(place, "2028-02-28", "09:30", 0)).toBeNull();
  expect(listedHoursWarning(place, "2028-02-28", "23:30", 60)).toBeNull();
  place.facts.hours!.monday = [{ opens: null, closes: "13:00", closed: false }];
  expect(listedHoursWarning(place, "2028-02-28", "09:30", 60)).toBeNull();
  place.facts.hours!.monday = [{ opens: "22:00", closes: "02:00", closed: false }];
  expect(listedHoursWarning(place, "2028-02-28", "09:30", 60)).toBeNull();
  place.source = "demo";
  place.facts.hours!.monday = [{ opens: "11:00", closes: "13:00", closed: false }];
  expect(listedHoursWarning(place, "2028-02-28", "09:30", 60)).toBeNull();
});
