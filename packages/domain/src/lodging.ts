import { type PlaceFacts, safePublicLink, validPlaceFacts } from "./facts";
export type LodgingCandidate = {
  id: string;
  destinationId: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  source: "qloo";
  taste: { queryId: string; rank: number };
  facts?: PlaceFacts;
};
/** A place entered by the traveler; no provider coordinates or taste evidence are implied. */
export type TravelerLodging = {
  id: string;
  destinationId: string;
  name: string;
  source: "traveler";
  address?: string;
  website?: string;
};
export type LodgingIdea = LodgingCandidate | TravelerLodging;
export type LodgingChoice = { stayId: string; candidate: LodgingIdea };
export function validLodgingIdea(value: unknown): value is LodgingIdea {
  if (!value || typeof value !== "object") return false;
  if ("source" in value && value.source === "qloo") return validLodgingCandidate(value);
  const place = value as TravelerLodging;
  return (
    place.source === "traveler" &&
    [place.id, place.destinationId, place.name].every(
      (item) => typeof item === "string" && item.trim().length > 0 && item.length <= 300,
    ) &&
    (place.address === undefined ||
      (typeof place.address === "string" && place.address.length <= 500)) &&
    (place.website === undefined || safePublicLink(place.website)) &&
    !["taste", "facts", "lat", "lng"].some((key) => key in value)
  );
}
export function lodgingAddress(idea: LodgingIdea): string | undefined {
  return idea.source === "traveler" ? idea.address : idea.facts?.address;
}
export function lodgingWebsite(idea: LodgingIdea): string | undefined {
  return idea.source === "traveler" ? idea.website : idea.facts?.website;
}
export function validLodgingCandidate(value: unknown): value is LodgingCandidate {
  if (!value || typeof value !== "object") return false;
  const place = value as LodgingCandidate;
  return (
    [place.id, place.destinationId, place.name].every(
      (item) => typeof item === "string" && item.trim().length > 0 && item.length <= 300,
    ) &&
    typeof place.description === "string" &&
    place.description.length <= 20000 &&
    place.source === "qloo" &&
    Number.isFinite(place.lat) &&
    Math.abs(place.lat) <= 90 &&
    Number.isFinite(place.lng) &&
    Math.abs(place.lng) <= 180 &&
    Boolean(place.taste) &&
    typeof place.taste.queryId === "string" &&
    place.taste.queryId.length > 0 &&
    Number.isSafeInteger(place.taste.rank) &&
    place.taste.rank > 0 &&
    (place.facts === undefined || validPlaceFacts(place.facts))
  );
}
