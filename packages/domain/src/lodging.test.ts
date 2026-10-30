import { expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import {
  type LodgingCandidate,
  type TravelerLodging,
  validLodgingCandidate,
  validLodgingIdea,
} from "./lodging";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";

test("planned lodging remains separate from visits, preserves rank and can be undone after reload", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  const route = {
    startDate: "2028-02-28",
    stays: [{ id: "a", destinationId: "lisbon", days: 3 }],
    transfers: [],
  };
  const routed = applyTripCommand(before, {
    id: "dates",
    baseVersion: 1,
    operations: [{ type: "set-route", route }],
  });
  if (!routed.ok) throw new Error(routed.error.message);
  const candidate: LodgingCandidate = {
    id: "fixture-hotel",
    destinationId: "lisbon",
    name: "Synthetic lodging fixture",
    description: "Not a real hotel recommendation",
    lat: 38.72,
    lng: -9.13,
    source: "qloo",
    taste: { queryId: "hotel-query", rank: 49 },
  };
  const result = applyTripCommand(routed.trip, {
    id: "lodging",
    baseVersion: 2,
    operations: [{ type: "select-lodging", stayId: "a", candidate }],
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.trip.stops).toEqual(before.stops);
  const saved = parseStoredTrip(result.trip)?.lodgings?.[0]?.candidate;
  expect(saved?.source === "qloo" && saved.taste.rank).toBe(49);
  const restored = parseStoredTrip(result.trip)!;
  const undone = undoTripCommand(restored, result.receipt, "undo-hotel");
  expect(undone.ok && undone.trip.lodgings === undefined).toBe(true);
  candidate.destinationId = "porto";
  expect(
    applyTripCommand(routed.trip, {
      id: "wrong-city",
      baseVersion: 2,
      operations: [{ type: "select-lodging", stayId: "a", candidate }],
    }).ok,
  ).toBe(false);
});

test("traveler lodging survives commands and storage without inventing coordinates or Qloo evidence", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  const routed = applyTripCommand(before, {
    id: "manual-dates",
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
    ],
  });
  if (!routed.ok) throw new Error(routed.error.message);
  const candidate: TravelerLodging = {
    id: "manual-hotel",
    name: "Traveler lodging fixture",
    destinationId: "lisbon",
    source: "traveler",
    address: "Private address fixture",
    website: "https://example.test/stay",
  };
  expect(validLodgingCandidate(candidate)).toBe(false);
  expect(validLodgingIdea(candidate)).toBe(true);
  const command = {
    id: "manual-stay",
    baseVersion: routed.trip.version,
    operations: [{ type: "select-lodging" as const, stayId: "a", candidate }],
  };
  const result = applyTripCommand(routed.trip, command);
  if (!result.ok) throw new Error(result.error.message);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
  if (!restored) throw new Error("Manual lodging failed storage validation");
  expect(restored.lodgings?.[0]?.candidate).toEqual(candidate);
  expect(restored.stops).toEqual(before.stops);
  const replay = applyTripCommand(restored, command);
  expect(replay.ok && replay.replayed).toBe(true);
  const undone = undoTripCommand(restored, result.receipt, "undo-manual-lodging");
  expect(undone.ok && undone.trip.lodgings).toBeUndefined();
  expect(
    applyTripCommand(routed.trip, {
      ...command,
      id: "wrong-city-manual",
      operations: [
        {
          type: "select-lodging",
          stayId: "a",
          candidate: { ...candidate, destinationId: "porto" },
        },
      ],
    }).ok,
  ).toBe(false);
  expect(applyTripCommand(before, { ...command, baseVersion: 1 }).ok).toBe(false);
});

test("traveler lodging rejects unsafe links and forged provider evidence", () => {
  const candidate: TravelerLodging = {
    id: "manual",
    name: "Fixture stay",
    destinationId: "lisbon",
    source: "traveler",
  };
  for (const patch of [
    { website: "javascript:alert(1)" },
    { website: "https://user:password@example.test/" },
    { website: "http://localhost/stay" },
    { name: " " },
    { address: "x".repeat(501) },
    { taste: { queryId: "forged", rank: 1 } },
    { facts: { source: "qloo" } },
    { lat: 38.7 },
    { lng: -9.1 },
  ])
    expect(validLodgingIdea({ ...candidate, ...patch })).toBe(false);
  expect(validLodgingIdea({ ...candidate, source: "qloo" })).toBe(false);
  expect(validLodgingIdea({ ...candidate, website: "https://example.test/stay" })).toBe(true);
});
