import { expect, test } from "bun:test";
import { createDemoTrip, createTripFromPlaces, DEFAULT_BRIEF, DESTINATIONS } from "./fixtures";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";

test("trip title and visit comments survive receipts, reload, retry and undo", () => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  const stop = trip.stops[0]!;
  const command = {
    id: "reference-title-comment",
    baseVersion: trip.version,
    operations: [
      { type: "set-trip-title" as const, title: "Portugal, at our own pace" },
      { type: "set-stop-note" as const, stopId: stop.id, note: "Meet outside the entrance." },
    ],
  };
  const result = applyTripCommand(trip, command);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
  expect(restored?.title).toBe("Portugal, at our own pace");
  expect(restored?.stops[0]?.note).toBe("Meet outside the entrance.");
  expect(restored && applyTripCommand(restored, command).ok).toBe(true);
  const undo = undoTripCommand(result.trip, result.receipt, "reference-undo");
  expect(undo.ok).toBe(true);
  if (!undo.ok) return;
  expect(undo.trip.title).toBeUndefined();
  expect(undo.trip.stops[0]?.note).toBeUndefined();
  expect(parseStoredTrip(undo.trip)).not.toBeNull();
  expect(
    applyTripCommand(trip, {
      ...command,
      operations: [{ type: "set-trip-title", title: "bad\ntitle" }],
    }).ok,
  ).toBe(false);
  expect(
    applyTripCommand(trip, {
      ...command,
      operations: [{ type: "set-stop-note", stopId: stop.id, note: "x".repeat(2001) }],
    }).ok,
  ).toBe(false);
});

test("a 12-day route persists every date without inventing places; the 30-day bound is shared", () => {
  const trip = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 12 }, []);
  const result = applyTripCommand(trip, {
    id: "twelve-days",
    baseVersion: trip.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: "2027-03-25",
          stays: [
            { id: "lisbon-stay", destinationId: "lisbon", destination: DESTINATIONS[0]!, days: 7 },
            { id: "porto-stay", destinationId: "porto", destination: DESTINATIONS[1]!, days: 5 },
          ],
          transfers: [
            { id: "transfer", fromStayId: "lisbon-stay", toStayId: "porto-stay", mode: "train" },
          ],
        },
      },
    ],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.trip.days.at(-1)?.date).toBe("2027-04-05");
  expect(result.trip.stops).toEqual([]);
  expect(parseStoredTrip(result.trip)?.days).toHaveLength(12);
  expect(() => createTripFromPlaces({ ...DEFAULT_BRIEF, days: 31 }, [])).toThrow();
});

test("original brief, traveler categories and flexible months survive storage and reject corruption", () => {
  const trip = createTripFromPlaces(
    {
      ...DEFAULT_BRIEF,
      partySize: 3,
      details: {
        request: "Quiet museums, a vegetarian lunch and time to wander.",
        travelers: { adults: 2, children: 1, infants: 0, pets: 1 },
        flexibleMonths: ["2027-03", "2027-04"],
      },
    },
    [],
  );
  expect(parseStoredTrip(trip)?.brief.details).toEqual(trip.brief.details);
  expect(
    parseStoredTrip({
      ...trip,
      brief: {
        ...trip.brief,
        details: {
          ...trip.brief.details,
          travelers: { adults: 1, children: 0, infants: 0, pets: 0 },
        },
      },
    }),
  ).toBeNull();
  expect(parseStoredTrip({ ...trip, title: 17 })).toBeNull();
  expect(() =>
    createTripFromPlaces(
      { ...trip.brief, details: { ...trip.brief.details!, flexibleMonths: ["2027-99"] } },
      [],
    ),
  ).toThrow();
});

test("legacy reference title receipts remain replayable across the integration", () => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  const command = {
    id: "legacy-title",
    baseVersion: trip.version,
    operations: [{ type: "set-title" as const, title: "Retained private draft" }],
  };
  const result = applyTripCommand(trip, command);
  if (!result.ok) throw new Error(result.error.message);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
  expect(restored?.title).toBe("Retained private draft");
  const replay = restored && applyTripCommand(restored, command);
  expect(replay?.ok && replay.replayed).toBe(true);
  const undo = restored && undoTripCommand(restored, result.receipt, "undo-legacy-title");
  expect(undo?.ok && undo.trip.title).toBeUndefined();
});
