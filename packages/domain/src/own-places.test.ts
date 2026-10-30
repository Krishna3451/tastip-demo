import { expect, test } from "bun:test";
import { createDemoTrip, createTripFromPlaces, DEFAULT_BRIEF, DESTINATIONS } from "./fixtures";
import { type OwnPlace, ownPlaceNearCity, validOwnPlace } from "./own-places";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";

const pin: OwnPlace = {
  id: "traveler:fixture-pin",
  name: "My riverside spot",
  category: "outdoors",
  description: "Traveler-entered contract fixture, not a verified venue.",
  destinationId: "lisbon",
  lat: 38.72,
  lng: -9.14,
  source: "traveler",
  practical: { hours: "unknown", cost: "unknown" },
};

test("own pins persist as unscheduled ideas without changing Qloo selection identity or rank", () => {
  const inventory = createDemoTrip(DEFAULT_BRIEF)
    .places.slice(0, 4)
    .map((place, index) => ({
      ...place,
      source: "qloo" as const,
      taste: { queryId: "original-query", rank: index + 1 },
    }));
  const before = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 1 }, inventory);
  const command = {
    id: "add-own-pin",
    baseVersion: before.version,
    operations: [{ type: "set-own-place" as const, place: pin }],
  };
  const result = applyTripCommand(before, command);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.trip.stops).toEqual(before.stops);
  expect(result.trip.places.filter((place) => place.source === "qloo")).toEqual(before.places);
  expect(result.trip.places.at(-1)).toEqual(pin);
  expect(before.places).toHaveLength(4);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
  if (!restored) throw new Error("Own pin could not be restored");
  const replay = applyTripCommand(restored, command);
  expect(replay.ok && replay.replayed).toBe(true);
  const undone = undoTripCommand(restored, result.receipt, "undo-own-pin");
  expect(undone.ok && undone.trip.places).toEqual(before.places);
});

test("own places can be scheduled, corrected and removed with guarded identity and exact undo", () => {
  const before = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const visit = {
    id: "own-visit",
    placeId: pin.id,
    dayId: "day-1",
    startTime: "15:30",
    durationMinutes: 60,
    pinned: false,
    timeLocked: false,
    note: "Private reminder",
  };
  const added = applyTripCommand(before, {
    id: "schedule-pin",
    baseVersion: 1,
    operations: [
      { type: "set-own-place", place: pin },
      { type: "add-stop", stop: visit },
    ],
  });
  if (!added.ok) throw new Error(added.error.message);
  expect(added.trip.stops.at(-1)).toEqual(visit);
  const corrected = applyTripCommand(added.trip, {
    id: "correct-pin",
    baseVersion: added.trip.version,
    operations: [
      { type: "set-own-place", place: { ...pin, name: "My corrected spot", lat: 38.721 } },
    ],
  });
  if (!corrected.ok) throw new Error(corrected.error.message);
  expect(corrected.trip.places.at(-1)?.name).toBe("My corrected spot");
  expect(corrected.trip.stops.at(-1)?.note).toBe("Private reminder");
  expect(corrected.trip.stops.at(-1)?.selection).toBeUndefined();
  expect(
    applyTripCommand(corrected.trip, {
      id: "remove-used-pin",
      baseVersion: corrected.trip.version,
      operations: [{ type: "remove-place-idea", placeId: pin.id }],
    }).ok,
  ).toBe(false);
  const removed = applyTripCommand(corrected.trip, {
    id: "remove-pin",
    baseVersion: corrected.trip.version,
    operations: [
      { type: "remove-stop", stopId: visit.id },
      { type: "remove-place-idea", placeId: pin.id },
    ],
  });
  if (!removed.ok) throw new Error(removed.error.message);
  expect(removed.trip.places.some((place) => place.id === pin.id)).toBe(false);
  const restored = parseStoredTrip(removed.trip);
  if (!restored) throw new Error("Removed pin history could not be restored");
  const undone = undoTripCommand(restored, removed.receipt, "undo-removed-pin");
  expect(undone.ok && undone.trip.places).toEqual(corrected.trip.places);
  expect(undone.ok && undone.trip.stops).toEqual(corrected.trip.stops);
});

test("own pins reject forged provider evidence, invalid locations and wrong-city writes atomically", () => {
  const before = createDemoTrip(DEFAULT_BRIEF);
  for (const patch of [
    { taste: { queryId: "fake", rank: 1 } },
    { facts: {} },
    { lat: 91 },
    { lng: Number.NaN },
    { id: "qloo-id" },
    { name: " " },
    { name: "x".repeat(301) },
    { source: "qloo" },
  ])
    expect(validOwnPlace({ ...pin, ...patch })).toBe(false);
  expect(ownPlaceNearCity(pin, DESTINATIONS[0]!)).toBe(true);
  expect(ownPlaceNearCity({ lat: 40, lng: -9.14 }, DESTINATIONS[0]!)).toBe(false);
  for (const place of [
    { ...pin, destinationId: "porto" },
    { ...pin, lat: 40 },
    { ...pin, taste: { queryId: "fake", rank: 1 } },
  ]) {
    expect(
      applyTripCommand(before, {
        id: crypto.randomUUID(),
        baseVersion: 1,
        operations: [
          { type: "pin-stop", stopId: before.stops[0]!.id, pinned: true },
          { type: "set-own-place", place: place as OwnPlace },
        ],
      }).ok,
    ).toBe(false);
    expect(before.stops[0]?.pinned).toBe(false);
  }
  expect(
    parseStoredTrip({ ...before, places: [...before.places, { ...pin, facts: {} }] }),
  ).toBeNull();
  const added = applyTripCommand(before, {
    id: "pin-evidence-guard",
    baseVersion: 1,
    operations: [{ type: "set-own-place", place: pin }],
  });
  if (!added.ok) throw new Error(added.error.message);
  expect(
    applyTripCommand(added.trip, {
      id: "forged-selection",
      baseVersion: added.trip.version,
      operations: [
        {
          type: "add-stop",
          stop: {
            id: "forged",
            placeId: pin.id,
            dayId: "day-1",
            startTime: "15:30",
            durationMinutes: 60,
            pinned: false,
            timeLocked: false,
            selection: { queryId: "fake", rank: 1 },
          },
        },
      ],
    }).ok,
  ).toBe(false);
});

test("unused ideas can be removed without changing selected visits or their source records", () => {
  const before = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const idea = before.places.find(
    (place) => !before.stops.some((stop) => stop.placeId === place.id),
  )!;
  const removed = applyTripCommand(before, {
    id: "remove-unused",
    baseVersion: 1,
    operations: [{ type: "remove-place-idea", placeId: idea.id }],
  });
  if (!removed.ok) throw new Error(removed.error.message);
  expect(removed.trip.stops).toEqual(before.stops);
  expect(removed.trip.places).toHaveLength(before.places.length - 1);
  const undone = undoTripCommand(removed.trip, removed.receipt, "undo-unused-removal");
  expect(undone.ok && undone.trip.places).toEqual(before.places);
});

test("a full inventory permits pin corrections and requires space for another idea", () => {
  const before = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 1 }, []);
  before.places = Array.from({ length: 150 }, (_, index) => ({
    ...pin,
    id: `traveler:pin-${index}`,
  }));
  const rejected = applyTripCommand(before, {
    id: "pin-at-capacity",
    baseVersion: before.version,
    operations: [{ type: "set-own-place", place: pin }],
  });
  expect(rejected.ok).toBe(false);
  if (!rejected.ok) expect(rejected.error.code).toBe("PLACE_LIMIT");
  const corrected = applyTripCommand(before, {
    id: "correct-at-capacity",
    baseVersion: before.version,
    operations: [
      {
        type: "set-own-place",
        place: { ...pin, id: "traveler:pin-0", name: "Corrected full-inventory pin" },
      },
    ],
  });
  if (!corrected.ok) throw new Error(corrected.error.message);
  expect(corrected.trip.places).toHaveLength(150);
  expect(corrected.trip.places[0]?.name).toBe("Corrected full-inventory pin");
  const replaced = applyTripCommand(corrected.trip, {
    id: "make-room-for-pin",
    baseVersion: corrected.trip.version,
    operations: [
      { type: "remove-place-idea", placeId: "traveler:pin-149" },
      { type: "set-own-place", place: pin },
    ],
  });
  if (!replaced.ok) throw new Error(replaced.error.message);
  expect(replaced.trip.places).toHaveLength(150);
  expect(replaced.trip.places.at(-1)?.id).toBe(pin.id);
});
