import { expect, test } from "bun:test";
import type { Destination, Place } from "@tastip/domain";
import {
  EMPTY_SAVED_WORKSPACE,
  parseSavedWorkspace,
  savedCollectionNote,
  savedCollectionSchema,
} from "./saved-workspace";

const destination: Destination = {
  id: "saved-cloud-fixture-city",
  name: "Synthetic saved city",
  country: "Test fixture",
  lat: 52.52,
  lng: 13.405,
  timeZone: "Europe/Berlin",
};
const place: Place = {
  id: "qloo:cloud-place-fixture",
  destinationId: destination.id,
  name: "Synthetic Qloo save",
  description: "Synthetic sourced place for saved workspace tests.",
  source: "qloo",
  category: "culture",
  lat: 52.521,
  lng: 13.406,
  taste: { queryId: "cloud-query-fixture", rank: 7, score: 0.42 },
  practical: { hours: "unknown", cost: "unknown" },
  facts: {
    source: "qloo",
    retrievedAt: "2026-10-30T10:00:00Z",
    website: "https://example.com/fixture",
    address: "Synthetic fixture address",
  },
};
const collection = {
  id: "00000000-0000-4000-8000-000000000027",
  name: "Art ideas",
  placeIds: [place.id, "orphan:legacy-fixture"],
};
function fixture() {
  return structuredClone({ places: [{ place, destination }], collections: [collection] });
}

test("saved workspace validates source evidence, custom cities and unresolved legacy memberships without copying unknown fields", () => {
  const input = { ...fixture(), discarded: "unknown top-level field" };
  const parsed = parseSavedWorkspace(input);
  expect(parsed).toEqual(fixture());
  expect(parsed?.places[0]?.place.taste).toEqual(place.taste);
  expect(parsed?.places[0]?.place.facts).toEqual(place.facts);
  expect(parsed?.collections[0]?.placeIds).toEqual([place.id, "orphan:legacy-fixture"]);
  if (!parsed) throw new Error("Valid saved workspace should parse.");
  parsed.places[0]!.place.name = "Mutated outside parser";
  parsed.collections[0]!.placeIds.push("another:membership");
  expect(input.places[0]?.place.name).toBe(place.name);
  expect(input.collections[0]?.placeIds).toEqual(collection.placeIds);
  expect(parseSavedWorkspace(EMPTY_SAVED_WORKSPACE)).toEqual({ places: [], collections: [] });
});

test("saved workspace rejects damaged/duplicate/oversized records as a whole", () => {
  const valid = fixture();
  const cases: unknown[] = [
    null,
    [],
    {},
    { ...valid, places: undefined },
    { ...valid, collections: undefined },
    { ...valid, places: [...valid.places, ...valid.places] },
    { ...valid, collections: [collection, collection] },
    { ...valid, collections: [{ ...collection, placeIds: [place.id, place.id] }] },
    { ...valid, collections: [{ ...collection, id: "invalid" }] },
    { ...valid, collections: [{ ...collection, name: " " }] },
    { ...valid, collections: [{ ...collection, name: "x".repeat(51) }] },
    {
      ...valid,
      collections: [
        { ...collection, placeIds: Array.from({ length: 151 }, (_, i) => `place-${i}`) },
      ],
    },
    {
      ...valid,
      collections: Array.from({ length: 51 }, (_, i) => ({
        ...collection,
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      })),
    },
    { ...valid, places: [{ place: { ...place, destinationId: "another-city" }, destination }] },
    { ...valid, places: [{ place: { ...place, source: "traveler" }, destination }] },
    { ...valid, ignored: "x".repeat(4_000_001) },
    { ...valid, ignored: "é".repeat(2_000_001) },
  ];
  for (const value of cases) expect(parseSavedWorkspace(value)).toBeNull();
  const cycle: Record<string, unknown> = { ...valid };
  cycle.self = cycle;
  expect(parseSavedWorkspace(cycle)).toBeNull();
  expect(valid).toEqual(fixture());
});

test("saved traveler pins keep their own provenance while collection names are normalized", () => {
  const own: Place = { ...place, id: "traveler:cloud-pin-fixture", source: "traveler" };
  delete own.taste;
  delete own.facts;
  const parsed = parseSavedWorkspace({
    places: [{ place: own, destination }],
    collections: [{ ...collection, name: "  Private pin ideas  " }],
  });
  expect(parsed?.places[0]?.place).toEqual(own);
  expect(parsed?.places[0]?.place.taste).toBeUndefined();
  expect(parsed?.collections[0]?.name).toBe("Private pin ideas");
});

test("place and membership bounds accept the limit without silently trimming records", () => {
  const places = Array.from({ length: 100 }, (_, index) => ({
    destination,
    place: { ...place, id: `qloo:bounded-save-${index}` },
  }));
  const memberships = Array.from({ length: 150 }, (_, index) => `member-${index}`);
  const input = { places, collections: [{ ...collection, placeIds: memberships }] };
  expect(parseSavedWorkspace(input)?.places).toHaveLength(100);
  expect(parseSavedWorkspace(input)?.collections[0]?.placeIds).toHaveLength(150);
  expect(
    parseSavedWorkspace({
      ...input,
      places: [...places, { destination, place: { ...place, id: "qloo:one-save-too-many" } }],
    }),
  ).toBeNull();
  expect(input.places).toHaveLength(100);
});

test("private collection notes round-trip with whitespace, clearing markers and unresolved legacy places", () => {
  const input = {
    ...fixture(),
    collections: [
      {
        ...collection,
        placeNotes: {
          [place.id]: "First line\n  Keep this indentation.",
          "orphan:legacy-fixture": "",
          "unresolved-note": "Retain until its place arrives",
        },
      },
    ],
  };
  const parsed = parseSavedWorkspace(input)!;
  expect(parsed.collections[0]?.placeNotes).toEqual(input.collections[0]!.placeNotes);
  expect(parsed.places[0]?.place.taste).toEqual(place.taste);
  expect(parsed.places[0]?.place.facts).toEqual(place.facts);
  parsed.collections[0]!.placeNotes![place.id] = "Changed returned note";
  expect(input.collections[0]!.placeNotes[place.id]).toBe("First line\n  Keep this indentation.");
  expect(parseSavedWorkspace(fixture())?.collections[0]).not.toHaveProperty("placeNotes");
});

test("private notes reject damaged or oversized maps without trimming or erasing the snapshot", () => {
  const maximum = Object.fromEntries(
    Array.from({ length: 150 }, (_, i) => [`note-${i}`, "x".repeat(2000)]),
  );
  const input = { ...fixture(), collections: [{ ...collection, placeNotes: maximum }] };
  expect(parseSavedWorkspace(input)?.collections[0]?.placeNotes).toEqual(maximum);
  for (const placeNotes of [
    null,
    [],
    "note",
    { [place.id]: 7 },
    { [place.id]: "x".repeat(2001) },
    { "": "blank ID" },
    { " ": "blank ID" },
    { ["x".repeat(201)]: "long ID" },
    { ...maximum, overflow: "one too many" },
  ]) {
    expect(
      parseSavedWorkspace({ ...fixture(), collections: [{ ...collection, placeNotes }] }),
    ).toBeNull();
  }
  expect(Object.keys(input.collections[0]!.placeNotes)).toHaveLength(150);
});

test("prototype-named imported notes are rejected before record normalization can erase them", () => {
  for (const text of ["Private imported note", ""]) {
    const placeNotes = JSON.parse(`{"__proto__":${JSON.stringify(text)}}`);
    const imported = { ...collection, placeIds: ["__proto__"], placeNotes };
    const before = JSON.stringify(imported);
    expect(savedCollectionSchema.safeParse(imported).success).toBe(false);
    expect(parseSavedWorkspace({ ...fixture(), collections: [imported] })).toBeNull();
    expect(JSON.stringify(imported)).toBe(before);
    expect(Object.hasOwn(imported.placeNotes, "__proto__")).toBe(true);
  }
});

test("note reads ignore inherited properties while preserving explicit legacy keys and clearings", () => {
  const empty = savedCollectionSchema.parse({ ...collection, placeNotes: {} });
  for (const key of Object.getOwnPropertyNames(Object.prototype))
    expect(savedCollectionNote(empty, key)).toBeUndefined();
  const legacy = savedCollectionSchema.parse({
    ...collection,
    placeNotes: { constructor: "Explicit legacy note", toString: "" },
  });
  expect(savedCollectionNote(legacy, "constructor")).toBe("Explicit legacy note");
  expect(savedCollectionNote(legacy, "toString")).toBe("");
  expect(savedCollectionNote(legacy, "unknown")).toBeUndefined();
  expect(JSON.parse(JSON.stringify(legacy)).placeNotes).toEqual({
    constructor: "Explicit legacy note",
    toString: "",
  });
});
