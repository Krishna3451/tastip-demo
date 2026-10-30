import { describe, expect, test } from "bun:test";
import {
  applyTripCommand,
  createDemoTrip,
  DEFAULT_BRIEF,
  feedbackTasteSignals,
  nextTasteQuestion,
  parseStoredTrip,
  refineTastePlaces,
} from "./index";

describe("explicit taste refinement", () => {
  test("questions adapt to confirmed seed types without asserting personality", () => {
    expect(
      nextTasteQuestion([{ id: "a", name: "An artist", type: "urn:entity:artist" }]).title,
    ).toContain("sound");
    expect(
      nextTasteQuestion([{ id: "b", name: "A book", type: "urn:entity:book" }]).title,
    ).toContain("draws");
  });
  test("category constraints preserve provider rank and exclusions beat likes", () => {
    const trip = createDemoTrip(DEFAULT_BRIEF);
    trip.places = trip.places.map((p, i) => ({
      ...p,
      source: "qloo",
      taste: { queryId: "q", rank: i + 1 },
    }));
    const cafes = refineTastePlaces(trip.places, ["cafe"]);
    expect(cafes.map((p) => p.taste?.rank)).toEqual([1]);
    expect(refineTastePlaces(trip.places, [], [trip.places[0]!.id])).toHaveLength(7);
    trip.stops[0]!.feedback = "more";
    expect(feedbackTasteSignals(trip).likedIds).toEqual([trip.places[0]!.id]);
  });
  test("feedback and confirmed favorites survive command replay and reload", () => {
    const trip = createDemoTrip({
      ...DEFAULT_BRIEF,
      tasteProfile: {
        seeds: [{ id: "seed", name: "Favorite", type: "urn:entity:book" }],
        dayStyle: "Art",
        categories: ["culture"],
      },
    });
    const result = applyTripCommand(trip, {
      id: "feedback-1",
      baseVersion: 1,
      operations: [{ type: "rate-stop", stopId: trip.stops[0]!.id, feedback: "less" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = parseStoredTrip(JSON.parse(JSON.stringify(result.trip)));
    expect(restored?.stops[0]?.feedback).toBe("less");
    expect(restored?.brief.tasteProfile?.seeds[0]?.name).toBe("Favorite");
    const repeated = applyTripCommand(result.trip, {
      id: "feedback-1",
      baseVersion: 1,
      operations: [{ type: "rate-stop", stopId: trip.stops[0]!.id, feedback: "less" }],
    });
    expect(repeated.ok && repeated.replayed).toBe(true);
  });
});
