import type { Destination, Place } from "./types";

export type OwnPlace = Omit<Place, "source" | "taste" | "facts" | "destinationId"> & {
  source: "traveler";
  destinationId: string;
  taste?: never;
  facts?: never;
};
export const MAX_OWN_PLACE_DISTANCE_KM = 50;

export function validOwnPlace(value: unknown): value is OwnPlace {
  if (!value || typeof value !== "object") return false;
  const place = value as OwnPlace;
  return (
    place.source === "traveler" &&
    typeof place.id === "string" &&
    place.id.startsWith("traveler:") &&
    place.id.length > 9 &&
    place.id.length <= 150 &&
    typeof place.destinationId === "string" &&
    place.destinationId.trim().length > 0 &&
    place.destinationId.length <= 150 &&
    typeof place.name === "string" &&
    place.name.trim().length > 0 &&
    place.name.length <= 300 &&
    typeof place.description === "string" &&
    place.description.length <= 2000 &&
    ["cafe", "culture", "food", "outdoors", "shop"].includes(place.category) &&
    Number.isFinite(place.lat) &&
    Math.abs(place.lat) <= 90 &&
    Number.isFinite(place.lng) &&
    Math.abs(place.lng) <= 180 &&
    place.practical?.hours === "unknown" &&
    place.practical.cost === "unknown" &&
    !("taste" in value) &&
    !("facts" in value)
  );
}

export function ownPlaceNearCity(place: Pick<Place, "lat" | "lng">, city: Destination): boolean {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const sinLat = Math.sin(radians(place.lat - city.lat) / 2);
  const sinLng = Math.sin(radians(place.lng - city.lng) / 2);
  const square =
    sinLat ** 2 + Math.cos(radians(city.lat)) * Math.cos(radians(place.lat)) * sinLng ** 2;
  return (
    6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, square)))) <= MAX_OWN_PLACE_DISTANCE_KM
  );
}
