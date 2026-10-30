import { expect, test } from "bun:test";
import {
  costAmountText,
  costLineTotal,
  parseCostAmount,
  tripCostTotals,
  validTripCost,
} from "./costs";
import { createDemoTrip, DEFAULT_BRIEF } from "./fixtures";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand, validateTrip } from "./trip";
import type { TripCost } from "./types";

const ticket: TripCost = {
  id: "ticket",
  label: "Museum ticket",
  category: "activity",
  currency: "EUR",
  unitAmountMinor: 10,
  quantity: 3,
  appliesTo: "each-traveler",
  source: "traveler",
};

test("decimal planning amounts remain exact and respect currency precision and bounds", () => {
  expect(parseCostAmount("0.10", "EUR")).toBe(10);
  expect(parseCostAmount("0000.20", "EUR")).toBe(20);
  expect(parseCostAmount("23.5", "EUR")).toBe(2350);
  expect(costAmountText(2350, "EUR")).toBe("23.50");
  expect(parseCostAmount("1200", "JPY")).toBe(1200);
  expect(costAmountText(1200, "JPY")).toBe("1200");
  for (const invalid of ["", "-1", "0.001", "1e4", "1,000", "NaN", "10000000.01", "1."])
    expect(parseCostAmount(invalid, "EUR")).toBeNull();
  expect(parseCostAmount("10000000.00", "EUR")).toBe(1_000_000_000);
  expect(parseCostAmount("1200.5", "JPY")).toBeNull();
  expect(costLineTotal(ticket, 2)).toBe(60);
  const totals = tripCostTotals({
    brief: { ...DEFAULT_BRIEF, partySize: 2 },
    costs: [
      ticket,
      { ...ticket, id: "snack", unitAmountMinor: 20, quantity: 1, appliesTo: "party" },
      {
        ...ticket,
        id: "room",
        category: "lodging",
        unitAmountMinor: 10000,
        quantity: 2,
        appliesTo: "party",
      },
      { ...ticket, id: "yen", currency: "JPY", unitAmountMinor: 500, quantity: 1 },
    ],
  });
  expect(totals).toEqual([
    { currency: "EUR", totalMinor: 20080, activityMinor: 80 },
    { currency: "JPY", totalMinor: 1000, activityMinor: 1000 },
  ]);
});

test("cost edits persist, replay, reject stale changes and undo through the canonical trip", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  const command = {
    id: "cost-add",
    baseVersion: before.version,
    operations: [{ type: "set-cost" as const, cost: ticket }],
  };
  const added = applyTripCommand(before, command);
  if (!added.ok) throw new Error(added.error.message);
  expect(before.costs).toBeUndefined();
  expect(added.trip.costs).toEqual([ticket]);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(added.trip)))!;
  expect(restored).not.toBeNull();
  expect(restored.commandLog).toHaveLength(1);
  const replay = applyTripCommand(restored, command);
  expect(replay.ok && replay.replayed).toBe(true);
  const stale = applyTripCommand(restored, { ...command, id: "stale-cost" });
  expect(stale.ok).toBe(false);
  const edited = applyTripCommand(restored, {
    id: "edit-cost",
    baseVersion: restored.version,
    operations: [{ type: "set-cost", cost: { ...ticket, unitAmountMinor: 2000 } }],
  });
  if (!edited.ok) throw new Error(edited.error.message);
  expect(edited.trip.costs).toHaveLength(1);
  expect(edited.trip.costs?.[0]?.unitAmountMinor).toBe(2000);
  const removed = applyTripCommand(edited.trip, {
    id: "remove-cost",
    baseVersion: edited.trip.version,
    operations: [{ type: "remove-cost", costId: ticket.id }],
  });
  if (!removed.ok) throw new Error(removed.error.message);
  expect(removed.trip.costs).toEqual([]);
  const restoredRemoval = parseStoredTrip(JSON.parse(JSON.stringify(removed.trip)))!;
  const undone = undoTripCommand(restoredRemoval, removed.receipt, "undo-cost-removal");
  expect(undone.ok && undone.trip.costs).toEqual(edited.trip.costs);
  const undoneAdd = undoTripCommand(restored, added.receipt, "undo-cost-add");
  expect(undoneAdd.ok && undoneAdd.trip.costs).toBeUndefined();
});

test("invalid and excessive cost edits fail atomically without corrupting stored trips", () => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  for (const patch of [
    { currency: "XXX" },
    { unitAmountMinor: -1 },
    { unitAmountMinor: 0.1 },
    { quantity: 366 },
    { quantity: 0 },
    { source: "quote" },
    { label: " " },
    { appliesTo: "unknown" },
  ]) {
    const invalid = { ...ticket, ...patch };
    expect(validTripCost(invalid)).toBe(false);
    expect(parseStoredTrip({ ...trip, costs: [invalid] })).toBeNull();
  }
  expect(parseStoredTrip({ ...trip, costs: null })).toBeNull();
  expect(parseStoredTrip({ ...trip, costs: [ticket, ticket] })).toBeNull();
  const rejected = applyTripCommand(trip, {
    id: "bad-batch",
    baseVersion: 1,
    operations: [
      { type: "set-cost", cost: ticket },
      { type: "remove-cost", costId: "missing" },
    ],
  });
  expect(rejected.ok).toBe(false);
  expect(trip.costs).toBeUndefined();
  const full = {
    ...trip,
    costs: Array.from({ length: 100 }, (_, index) => ({ ...ticket, id: `cost-${index}` })),
  };
  expect(validateTrip(full)).toEqual([]);
  expect(
    applyTripCommand(full, {
      id: "overflow",
      baseVersion: 1,
      operations: [{ type: "set-cost", cost: ticket }],
    }).ok,
  ).toBe(false);
  expect(parseStoredTrip({ ...full, costs: [...full.costs, ticket] })).toBeNull();
  expect(validateTrip({ ...trip, brief: { ...trip.brief, partySize: 21 } })).not.toEqual([]);
});
