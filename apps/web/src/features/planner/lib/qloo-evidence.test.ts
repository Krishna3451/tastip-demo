import { describe, expect, test } from "bun:test";
import { createTripFromPlaces, DEFAULT_BRIEF, type Place, type Trip } from "@tastip/domain";
import { qlooDayEvidence } from "./qloo-evidence";

function candidate(id: string, destinationId = "lisbon"): Place {
  return {
    id,
    destinationId,
    name: `Synthetic ${id} evidence fixture`,
    category: "culture",
    description: "Synthetic evidence test fixture, not a live recommendation.",
    lat: 38.72,
    lng: -9.13,
    source: "qloo",
    taste: { queryId: `query-${id}`, rank: 7 },
    practical: { hours: "unknown", cost: "unknown" },
  };
}

describe("Qloo day evidence", () => {
  test("repeated visits retain separate selection queries despite a newer place-level rank", () => {
    const trip = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 2 }, [candidate("repeated")]);
    const first = trip.stops[0]!;
    first.selection = { queryId: "query-repeated", rank: 7 };
    const second = {
      ...first,
      id: "second-query-visit",
      dayId: "day-2",
      selection: { queryId: "second-query", rank: 23 },
    };
    trip.stops.push(second);
    trip.places[0]!.taste = { queryId: "later-place-query", rank: 71 };
    expect(qlooDayEvidence(trip, "day-1")?.visits[0]?.evidence).toEqual({
      queryId: "query-repeated",
      rank: 7,
    });
    expect(qlooDayEvidence(trip, "day-2")?.visits[0]?.evidence).toEqual(second.selection);
    delete first.selection;
    expect(qlooDayEvidence(trip, "day-1")?.visits[0]?.evidence).toBeUndefined();
    expect(qlooDayEvidence(trip, "day-1")?.visits).toHaveLength(1);
  });

  test("ideas stay unscheduled and city-scoped while sample and traveler visits stay distinct", () => {
    const trip = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 2 }, [candidate("accepted")]);
    const original = trip.stops[0]!;
    trip.places.push(
      candidate("lisbon-idea"),
      candidate("porto-idea", "porto"),
      { ...candidate("sample"), source: "demo", taste: undefined },
      { ...candidate("own-place"), source: "traveler", taste: undefined },
    );
    trip.stops.push(
      { ...original, id: "sample-visit", placeId: "sample", selection: undefined },
      { ...original, id: "own-visit", placeId: "own-place", selection: undefined },
    );
    const before = JSON.stringify(trip);
    const evidence = qlooDayEvidence(trip, "day-1")!;
    expect(evidence.cityName).toBe("Lisbon");
    expect(evidence.visits.map(({ place }) => place.id)).toEqual(["accepted"]);
    expect(evidence.ideas.map((place) => place.id)).toEqual(["lisbon-idea"]);
    expect(evidence.sampleVisits).toBe(1);
    expect(evidence.travelerVisits).toBe(1);
    expect(JSON.stringify(trip)).toBe(before);
    expect(qlooDayEvidence(trip, "unknown-day")).toBeNull();
  });

  test("custom destination labels and original idea ranks survive without fabricated match scores", () => {
    const destination = {
      id: "synthetic-custom-city",
      name: "Synthetic Custom City",
      country: "Fixture country",
      lat: 48,
      lng: 2,
      timeZone: "Europe/Paris",
    };
    const trip: Trip = createTripFromPlaces(
      { ...DEFAULT_BRIEF, destinationId: destination.id, destination, days: 1 },
      [],
    );
    trip.places.push(candidate("custom-idea", destination.id));
    const evidence = qlooDayEvidence(trip, "day-1")!;
    expect(evidence.cityName).toBe(destination.name);
    expect(evidence.visits).toHaveLength(0);
    expect(evidence.ideas[0]?.taste).toEqual({ queryId: "query-custom-idea", rank: 7 });
    expect(evidence.ideas[0]?.taste?.score).toBeUndefined();
  });
});
