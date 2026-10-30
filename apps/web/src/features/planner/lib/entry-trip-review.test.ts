import { expect, test } from "bun:test";
import { DEFAULT_BRIEF, type TasteProfile, type TripRoute } from "@tastip/domain";
import { entryTripReview } from "./entry-trip-review";

const profile: TasteProfile = {
  seeds: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Synthetic artist",
      type: "urn:entity:artist",
    },
  ],
  dayStyle: "Art",
  categories: ["culture"],
  rhythm: "late",
  walking: "short",
};
test("entry review retains every accepted city stay/date and owns immutable taste inputs", () => {
  const route: TripRoute = {
    startDate: "2028-11-15",
    stays: [
      { id: "lisbon", destinationId: "lisbon", days: 2 },
      { id: "porto", destinationId: "porto", days: 2 },
    ],
    transfers: [{ id: "train", fromStayId: "lisbon", toStayId: "porto", mode: "train" }],
  };
  const brief = { ...DEFAULT_BRIEF, days: 4 };
  const before = structuredClone({ brief, route, profile });
  const review = entryTripReview(brief, profile, route);
  expect(review.route).toEqual(route);
  expect(review.brief).toMatchObject({ days: 4, partySize: 2, tasteProfile: profile });
  expect({ brief, route, profile }).toEqual(before);
  const second = route.stays[1];
  if (!second) throw new Error("Expected the second route city");
  second.days = 9;
  expect(review.route.stays[1]?.days).toBe(2);
  expect(review.brief.tasteProfile).not.toBe(profile);
});
test("single-city entry gets a flexible canonical route without inventing a date", () => {
  const review = entryTripReview({ ...DEFAULT_BRIEF, days: 3 }, profile);
  expect(review.route.startDate).toBeNull();
  expect(review.route.stays).toMatchObject([{ destinationId: "lisbon", days: 3 }]);
  expect(review.route.transfers).toEqual([]);
});
test("an invalid/mismatched route cannot enter generation", () => {
  expect(() =>
    entryTripReview(DEFAULT_BRIEF, profile, {
      startDate: null,
      stays: [{ id: "porto", destinationId: "porto", days: 2 }],
      transfers: [],
    }),
  ).toThrow("first city");
});
