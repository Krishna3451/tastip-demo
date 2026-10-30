import { expect, test } from "bun:test";
import { DESTINATIONS, type Destination, type Place } from "@tastip/domain";
import { parseSavedPlaceRecord, parseSavedPlaces } from "./saved-places";

const destination: Destination = {
  id: "saved-pin-fixture-city",
  name: "Synthetic saved-pin city",
  country: "Test fixture",
  lat: 52.52,
  lng: 13.405,
  timeZone: "Europe/Berlin",
};
const own: Place = {
  id: "traveler:saved-pin-fixture",
  destinationId: destination.id,
  name: "Synthetic personal place",
  category: "culture",
  description: "Private fixture note entered by the traveler.",
  lat: 52.521,
  lng: 13.406,
  source: "traveler",
  practical: { hours: "unknown", cost: "unknown" },
};

test("saved personal pins retain arbitrary-city geography and user provenance without composing a recommendation", () => {
  const value = { place: own, destination };
  const restored = parseSavedPlaceRecord(value);
  expect(restored).toEqual(value);
  expect(parseSavedPlaces(JSON.stringify([value]))).toEqual([value]);
  expect(restored?.place.taste).toBeUndefined();
  expect(restored?.place.facts).toBeUndefined();
  if (!restored) throw new Error("The saved fixture should restore.");
  restored.place.name = "Changed restored copy";
  restored.destination.name = "Changed restored city";
  expect(own.name).toBe("Synthetic personal place");
  expect(destination.name).toBe("Synthetic saved-pin city");
});

test("saved Qloo places retain query-local ranks and facts across queries and legacy record shapes", () => {
  const city = DESTINATIONS[0];
  if (!city) throw new Error("Missing city fixture.");
  const first: Place = {
    ...own,
    id: "qloo:saved-first-fixture",
    destinationId: city.id,
    source: "qloo",
    taste: { queryId: "saved-fixture-query-a", rank: 7, score: 0.42 },
    facts: {
      source: "qloo",
      retrievedAt: "2026-10-29T12:00:00Z",
      website: "https://example.com/fixture",
      address: "Synthetic fixture address",
    },
  };
  const second: Place = {
    ...first,
    id: "qloo:saved-second-fixture",
    taste: { queryId: "saved-fixture-query-b", rank: 7 },
  };
  const restored = parseSavedPlaces(JSON.stringify([first, { place: second }]));
  expect(restored).toEqual([
    { place: first, destination: city },
    { place: second, destination: city },
  ]);
  expect(restored?.map(({ place }) => place.taste)).toEqual([first.taste, second.taste]);
});

test("malformed saved caches fail closed without dropping records, fabricating cities or accepting forged source facts", () => {
  const valid = { place: own, destination };
  const invalid = [
    { place: own },
    { place: own, destination: { ...destination, id: "another-city" } },
    { place: own, destination: { ...destination, timeZone: "Not/AZone" } },
    { place: { ...own, destinationId: undefined }, destination },
    { place: { ...own, source: "other" }, destination },
    { place: { ...own, lat: 91 }, destination },
    { place: { ...own, taste: { queryId: "forged", rank: 1 } }, destination },
    {
      place: { ...own, facts: { source: "qloo", retrievedAt: "2026-10-29T12:00:00Z" } },
      destination,
    },
    { place: { ...own, source: "qloo" }, destination },
  ];
  for (const value of invalid) {
    expect(parseSavedPlaceRecord(value)).toBeNull();
    expect(parseSavedPlaces(JSON.stringify([valid, value]))).toBeNull();
  }
  expect(parseSavedPlaces(JSON.stringify([valid, valid]))).toBeNull();
  expect(parseSavedPlaces(JSON.stringify(Array.from({ length: 101 }, () => valid)))).toBeNull();
  expect(parseSavedPlaces("{")).toBeNull();
  expect(parseSavedPlaces("{}")).toBeNull();
  expect(parseSavedPlaces(" ".repeat(4_000_001))).toBeNull();
  expect(parseSavedPlaces("[]")).toEqual([]);
});
