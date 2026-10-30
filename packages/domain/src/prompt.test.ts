import { expect, test } from "bun:test";
import { parseRoutePrompt, parseTripRequest } from "./prompt";

test("route sketch extracts only origin, city strings and explicit duration for review", () => {
  expect(parseRoutePrompt("From Delhi to Lisbon and Porto for 5 days with 2 people")).toEqual({
    origin: "Delhi",
    cityQueries: ["Lisbon", "Porto"],
    days: 5,
    partySize: 2,
  });
  expect(parseRoutePrompt("Visit Paris for 3 days").cityQueries).toEqual(["Paris"]);
});

test("trip descriptions retain explicit city order, flexible months, duration and traveler categories", () => {
  const parsed = parseTripRequest(
    "Lisbon and Porto for 5 days in March with 2 adults and 1 child",
    "2026-10-29",
  );
  expect(parsed.cityQueries).toEqual(["Lisbon", "Porto"]);
  expect(parsed.days).toBe(5);
  expect(parsed.flexibleMonths).toEqual(["2027-03"]);
  expect(parsed.counts).toEqual({ adults: 2, children: 1, infants: 0, pets: 0 });
  expect(parseTripRequest("5-day Tokyo trip this October", "2026-10-29").cityQueries).toEqual([
    "Tokyo",
  ]);
  expect(
    parseTripRequest("Plan me a 12-day trip to Copenhagen and Kyoto in May 2028", "2026-10-29"),
  ).toMatchObject({ cityQueries: ["Copenhagen", "Kyoto"], days: 12, flexibleMonths: ["2028-05"] });
  expect(
    parseTripRequest("From Delhi to Lisbon and Porto for 5 days with 2 people", "2026-10-29"),
  ).toMatchObject({ origin: "Delhi", cityQueries: ["Lisbon", "Porto"], counts: { adults: 2 } });
  expect(
    parseTripRequest("Lisbon for a relaxed museum and coffee trip.", "2026-10-29").cityQueries,
  ).toEqual(["Lisbon"]);
});
