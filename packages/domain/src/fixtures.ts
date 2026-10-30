import { briefDestination } from "./destinations";
import { validTripDetails } from "./details";
import { listedDraftVisitTime } from "./draft-hours";
import { MAX_TRIP_DAYS } from "./limits";
import { dateAt, isLocalDate } from "./route";
import type { Destination, Place, Trip, TripBrief } from "./types";

export const DESTINATIONS: Destination[] = [
  {
    id: "lisbon",
    name: "Lisbon",
    country: "Portugal",
    lat: 38.7223,
    lng: -9.1393,
    timeZone: "Europe/Lisbon",
  },
  {
    id: "porto",
    name: "Porto",
    country: "Portugal",
    lat: 41.1579,
    lng: -8.6291,
    timeZone: "Europe/Lisbon",
  },
  {
    id: "kyoto",
    name: "Kyoto",
    country: "Japan",
    lat: 35.0116,
    lng: 135.7681,
    timeZone: "Asia/Tokyo",
  },
  {
    id: "copenhagen",
    name: "Copenhagen",
    country: "Denmark",
    lat: 55.6761,
    lng: 12.5683,
    timeZone: "Europe/Copenhagen",
  },
];

export const DEFAULT_BRIEF: TripBrief = {
  destinationId: "lisbon",
  origin: "",
  days: 3,
  partySize: 2,
  budget: null,
  currency: "EUR",
  pace: "balanced",
  interests: ["Independent cafés", "Art & design", "Local food"],
};

const CONCEPTS: Array<Pick<Place, "name" | "category" | "description">> = [
  {
    name: "Demo · Slow Morning Café",
    category: "cafe",
    description:
      "A fictional coffee stop for trying the planner. Not a real venue or recommendation.",
  },
  {
    name: "Demo · Courtyard Art House",
    category: "culture",
    description:
      "A fictional art stop for trying the planner. Opening hours and availability are unknown.",
  },
  {
    name: "Demo · Neighborhood Table",
    category: "food",
    description:
      "A fictional lunch stop. No actual menu, price, reservation, or taste score is claimed.",
  },
  {
    name: "Demo · Hilltop Garden",
    category: "outdoors",
    description:
      "A fictional outdoor stop for exploring the journey view. Its location is illustrative.",
  },
  {
    name: "Demo · Paper & Stories",
    category: "shop",
    description: "A fictional book and design shop used to demonstrate itinerary editing.",
  },
  {
    name: "Demo · Evening Kitchen",
    category: "food",
    description: "A fictional dinner stop. No real booking or supplier availability exists.",
  },
  {
    name: "Demo · Listening Room",
    category: "culture",
    description:
      "A fictional alternative for trying a replacement. This is not a live Qloo result.",
  },
  {
    name: "Demo · Market Corner",
    category: "food",
    description:
      "A fictional food stop for testing a different day. Practical information is unknown.",
  },
];

function validateBrief(brief: TripBrief): Destination {
  if (brief.details !== undefined && !validTripDetails(brief.details, brief.partySize))
    throw new Error("Check your trip brief and traveler counts.");
  const destination = briefDestination(brief);
  if (!destination) throw new Error("Choose a supported destination before creating a trip.");
  if (!Number.isInteger(brief.days) || brief.days < 1 || brief.days > MAX_TRIP_DAYS)
    throw new Error(`Choose between 1 and ${MAX_TRIP_DAYS} days.`);
  if (!Number.isInteger(brief.partySize) || brief.partySize < 1 || brief.partySize > 20)
    throw new Error("Choose between 1 and 20 travelers.");
  if (brief.budget !== null && (!Number.isFinite(brief.budget) || brief.budget < 0))
    throw new Error("Budget must be a nonnegative amount or unknown.");
  if (!["slow", "balanced", "full"].includes(brief.pace))
    throw new Error("Choose a supported travel pace.");
  return destination;
}

/**
 * Shared draft composer: Qloo rank determines the selected inventory and order.
 * Dated listed hours guide automatic placement; live availability and routes remain unverified.
 * Insufficient inventory leaves partial/empty days, never invented repeat visits.
 */
export function createTripFromPlaces(
  brief: TripBrief,
  inventory: readonly Place[],
  startDate: string | null = null,
  canSchedule: (dayId: string, startTime: string, durationMinutes: number) => boolean = () => true,
): Trip {
  validateBrief(brief);
  if (
    startDate !== null &&
    (!isLocalDate(startDate) || !isLocalDate(dateAt(startDate, brief.days - 1)))
  )
    throw new Error("Choose a valid starting date before scheduling this draft.");
  const ids = new Set<string>();
  const queryIds = new Set<string>();
  const ranks = new Set<number>();
  let qlooCount = 0;
  for (const place of inventory) {
    if (!place || typeof place.id !== "string" || !place.id.trim() || ids.has(place.id))
      throw new Error("Candidate places must have unique, nonempty IDs.");
    ids.add(place.id);
    if (
      typeof place.name !== "string" ||
      !place.name.trim() ||
      typeof place.description !== "string" ||
      !["cafe", "culture", "food", "outdoors", "shop"].includes(place.category)
    )
      throw new Error("A candidate has malformed place details.");
    if (
      !Number.isFinite(place.lat) ||
      place.lat < -90 ||
      place.lat > 90 ||
      !Number.isFinite(place.lng) ||
      place.lng < -180 ||
      place.lng > 180
    )
      throw new Error("A candidate has invalid coordinates.");
    if (place.practical?.hours !== "unknown" || place.practical?.cost !== "unknown")
      throw new Error("This draft composer requires explicitly unknown practical facts.");
    if (place.source === "qloo") {
      qlooCount++;
      if (
        !place.taste ||
        typeof place.taste.queryId !== "string" ||
        !place.taste.queryId.trim() ||
        !Number.isInteger(place.taste.rank) ||
        place.taste.rank < 1 ||
        ranks.has(place.taste.rank)
      )
        throw new Error("Qloo candidates require one unique positive rank and a query reference.");
      if (
        place.taste.score !== undefined &&
        (!Number.isFinite(place.taste.score) || place.taste.score < 0 || place.taste.score > 1)
      )
        throw new Error("A Qloo affinity score must be within its documented range.");
      queryIds.add(place.taste.queryId);
      ranks.add(place.taste.rank);
    } else if (place.source !== "demo" || place.taste) {
      throw new Error("Demo inventory cannot carry fabricated Qloo taste evidence.");
    }
  }
  if (qlooCount && qlooCount !== inventory.length)
    throw new Error("Keep real Qloo candidates separate from synthetic demo inventory.");
  if (queryIds.size > 1)
    throw new Error(
      "Compose one Qloo query at a time; ranks and raw scores are not comparable across queries.",
    );
  if (inventory.some((place) => place.destinationId && place.destinationId !== brief.destinationId))
    throw new Error("Compose candidates from this destination only.");
  const places = structuredClone(
    inventory.map((place) => ({
      ...place,
      destinationId: place.destinationId ?? brief.destinationId,
    })),
  );
  if (qlooCount)
    places.sort((left, right) => (left.taste?.rank ?? Infinity) - (right.taste?.rank ?? Infinity));
  const days = Array.from({ length: brief.days }, (_, index) => ({
    id: `day-${index + 1}`,
    label: `Day ${index + 1}`,
    date: startDate === null ? null : dateAt(startDate, index),
  }));
  const times =
    brief.tasteProfile?.rhythm === "early"
      ? ["08:00", "11:00", "15:00"]
      : brief.tasteProfile?.rhythm === "late"
        ? ["11:00", "15:00", "20:00"]
        : brief.pace === "slow"
          ? ["10:00", "13:00", "17:00"]
          : brief.pace === "full"
            ? ["08:30", "11:00", "14:00", "18:00"]
            : ["09:30", "12:30", "17:00"];
  const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const earliest = minute(times[0] ?? "09:30");
  const latest =
    brief.tasteProfile?.rhythm === "early"
      ? 19 * 60
      : brief.tasteProfile?.rhythm === "late"
        ? 23 * 60
        : 21 * 60;
  const remaining = [...places];
  const stops: Trip["stops"] = [];
  for (const day of days) {
    for (const [index, preferred] of times.entries()) {
      for (const [candidateIndex, place] of remaining.entries()) {
        const startTime = listedDraftVisitTime(
          place,
          day.date,
          preferred,
          earliest,
          latest,
          (time) =>
            canSchedule(day.id, time, 60) &&
            !stops.some(
              (stop) =>
                stop.dayId === day.id &&
                minute(time) < minute(stop.startTime) + stop.durationMinutes &&
                minute(time) + 60 > minute(stop.startTime),
            ),
        );
        if (startTime === null) continue;
        remaining.splice(candidateIndex, 1);
        stops.push({
          id: `${day.id}-stop-${index + 1}`,
          placeId: place.id,
          dayId: day.id,
          startTime,
          durationMinutes: 60,
          ...(place.taste ? { selection: structuredClone(place.taste) } : {}),
          pinned: false,
          timeLocked: false,
        });
        break;
      }
    }
  }
  return {
    id: crypto.randomUUID(),
    version: 1,
    brief: structuredClone(brief),
    places,
    days,
    stops,
    appliedCommandIds: [],
    commandLog: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Original synthetic data for UI development; never presented as live provider output. */
export function createDemoTrip(brief: TripBrief): Trip {
  const destination = validateBrief(brief);
  const places: Place[] = CONCEPTS.map((concept, index) => ({
    id: `demo-${destination.id}-place-${index + 1}`,
    ...concept,
    lat: destination.lat + ((index % 3) - 1) * 0.006,
    lng: destination.lng + (Math.floor(index / 3) - 1) * 0.006,
    source: "demo",
    practical: { hours: "unknown", cost: "unknown" },
  }));
  return createTripFromPlaces(brief, places);
}
