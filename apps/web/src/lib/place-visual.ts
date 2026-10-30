import type { Place } from "@tastip/domain";

export type PlaceLandmark = "eiffel-tower" | "belem-tower" | "torii-gate" | "round-tower";

// Exact names and small presentation bounds, not city-wide identity guesses.
// Public source provenance: docs/place-visuals.md. This registry does not add visits.
const LANDMARKS: {
  visual: PlaceLandmark;
  names: readonly string[];
  bounds: readonly [south: number, west: number, north: number, east: number];
}[] = [
  {
    visual: "eiffel-tower",
    names: ["eiffel tower", "the eiffel tower", "tour eiffel", "la tour eiffel"],
    bounds: [48.8575, 2.293, 48.8595, 2.296],
  },
  {
    visual: "belem-tower",
    names: ["belem tower", "tower of belem", "torre de belem"],
    bounds: [38.6907, -9.2173, 38.6927, -9.2147],
  },
  {
    visual: "torii-gate",
    names: [
      "fushimi inari taisha",
      "fushimi inari taisha shrine",
      "fushimi inari shrine",
      "伏見稲荷大社",
      "senbon torii",
      "千本鳥居",
    ],
    bounds: [34.9658, 135.771, 34.969, 135.775],
  },
  {
    visual: "round-tower",
    names: ["round tower", "the round tower", "rundetaarn", "rundetarn"],
    bounds: [55.6805, 12.5745, 55.6821, 12.577],
  },
];

export function getPlaceLandmark(
  place: Pick<Place, "name" | "lat" | "lng" | "source">,
): PlaceLandmark | undefined {
  if (place.source !== "qloo") return undefined;
  const name = place.name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return LANDMARKS.find(
    ({ names, bounds: [south, west, north, east] }) =>
      names.includes(name) &&
      place.lat >= south &&
      place.lat <= north &&
      place.lng >= west &&
      place.lng <= east,
  )?.visual;
}
