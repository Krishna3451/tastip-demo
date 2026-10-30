import { expect, test } from "bun:test";
import { tripCostTotals } from "./costs";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";
import type { TripOperation } from "./types";

test("trip planning details update together without rescheduling visits or rewriting entered unit costs", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  before.costs = [
    {
      id: "each-ticket",
      label: "Entered ticket fixture",
      category: "activity",
      currency: "EUR",
      unitAmountMinor: 1250,
      quantity: 2,
      appliesTo: "each-traveler",
      source: "traveler",
    },
    {
      id: "room-fixture",
      label: "Entered room fixture",
      category: "lodging",
      currency: "JPY",
      unitAmountMinor: 12000,
      quantity: 1,
      appliesTo: "party",
      source: "traveler",
    },
  ];
  const command = {
    id: "trip-details-fixture",
    baseVersion: before.version,
    operations: [
      { type: "set-party-size", partySize: 3 },
      { type: "set-pace", pace: "slow" },
      { type: "set-activity-budget", currency: "EUR", amountMinor: 10001 },
    ] as TripOperation[],
  };
  const result = applyTripCommand(before, command);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.trip.brief).toEqual({
    ...before.brief,
    partySize: 3,
    pace: "slow",
    budget: 100.01,
  });
  expect(result.trip.stops).toEqual(before.stops);
  expect(result.trip.places).toEqual(before.places);
  expect(result.trip.costs).toEqual(before.costs);
  expect(tripCostTotals(result.trip)).toEqual([
    { currency: "EUR", totalMinor: 7500, activityMinor: 7500 },
    { currency: "JPY", totalMinor: 12000, activityMinor: 0 },
  ]);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
  if (!restored) throw new Error("Edited planning details did not restore");
  expect(restored.brief).toEqual(result.trip.brief);
  const replay = applyTripCommand(restored, command);
  expect(replay.ok && replay.replayed).toBe(true);
  const undone = undoTripCommand(restored, result.receipt, "undo-details-fixture");
  expect(undone.ok && undone.trip.brief).toEqual(before.brief);
  expect(undone.ok && tripCostTotals(undone.trip)).toEqual(tripCostTotals(before));
});

test("invalid planning details reject the whole edit, including an earlier valid operation", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  const invalid = [
    ...[0, 21, 1.5, Number.NaN].map((partySize) => ({ type: "set-party-size", partySize })),
    { type: "set-pace", pace: "instant" },
    ...[-1, 0.5, Number.POSITIVE_INFINITY, 1_000_000_001].map((amountMinor) => ({
      type: "set-activity-budget",
      currency: "EUR",
      amountMinor,
    })),
    { type: "set-activity-budget", currency: "XXX", amountMinor: 500 },
  ];
  for (const operation of invalid) {
    const result = applyTripCommand(before, {
      id: crypto.randomUUID(),
      baseVersion: before.version,
      operations: [{ type: "set-pace", pace: "full" }, operation as TripOperation],
    });
    expect(result.ok).toBe(false);
    expect(before.brief).toEqual(DEFAULT_BRIEF);
  }
});

test("zero, unknown and whole-yen budgets stay distinct while legacy budgets remain editable by party and pace", () => {
  let trip = createDemoTrip({ ...DEFAULT_BRIEF, currency: "BRL", budget: 123.456 });
  const party = applyTripCommand(trip, {
    id: "legacy-party",
    baseVersion: trip.version,
    operations: [
      { type: "set-party-size", partySize: 1 },
      { type: "set-pace", pace: "full" },
    ],
  });
  if (!party.ok) throw new Error(party.error.message);
  trip = party.trip;
  expect(parseStoredTrip(trip)?.brief).toMatchObject({
    currency: "BRL",
    budget: 123.456,
    partySize: 1,
    pace: "full",
  });
  for (const amountMinor of [0, 12345, null]) {
    const changed = applyTripCommand(trip, {
      id: crypto.randomUUID(),
      baseVersion: trip.version,
      operations: [{ type: "set-activity-budget", currency: "JPY", amountMinor }],
    });
    if (!changed.ok) throw new Error(changed.error.message);
    trip = changed.trip;
    expect(parseStoredTrip(trip)?.brief.budget).toBe(amountMinor);
    expect(trip.brief.currency).toBe("JPY");
  }
});
