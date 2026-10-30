import { expect, test } from "bun:test";
import { validPlaceFacts } from "@tastip/domain";
import { normalizePlaceFacts } from "./place-facts";

test("observed native metadata normalizes safe sourced hours and links without inventing price facts", () => {
  const facts = normalizePlaceFacts(
    {
      address: "Synthetic address",
      website: "https://example.com/venue",
      menu_url: "javascript:alert(1)",
      phone: null,
      hours: {
        monday: [{ opens: "T10:30:00", closes: "T22:30:00", closed: false }],
        tuesday: [{ opens: null, closes: null, closed: true }],
      },
      image: { url: "https://images.qloo.com/fixture.jpg" },
      price_range: { from: null, to: null, currency: "usd" },
    },
    "2026-10-29T00:00:00Z",
  );
  expect(facts?.hours?.monday).toEqual([{ opens: "10:30", closes: "22:30", closed: false }]);
  expect(facts?.menuUrl).toBeUndefined();
  expect(facts?.imageUrl).toBe("https://images.qloo.com/fixture.jpg");
  expect(validPlaceFacts(facts)).toBe(true);
  expect(JSON.stringify(facts)).not.toContain("price");
});

test("sourced menu descriptions remain text and do not imply dietary suitability", () => {
  const facts = normalizePlaceFacts(
    {
      specialty_dishes: "Synthetic dish description",
      cuisine_description: "Synthetic cuisine note",
    },
    "2026-10-29T00:00:00Z",
  );
  expect(facts?.specialtyDishes).toBe("Synthetic dish description");
  expect(facts?.cuisine).toBe("Synthetic cuisine note");
  expect(validPlaceFacts(facts)).toBe(true);
});
