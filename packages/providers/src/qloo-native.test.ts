import { expect, test } from "bun:test";
import { createQlooProvider } from "./qloo";

test("native search accepts results-only envelopes and types without conflating search tags", async () => {
  const provider = createQlooProvider({
    apiKey: "test-only",
    fetch: async () =>
      Response.json({
        results: [
          {
            entity_id: "seed",
            name: "Synthetic Artist",
            types: ["urn:entity:artist"],
            properties: { short_description: "A synthetic contract example." },
            tags: [{ tag_id: "urn:tag:genre:music:indie" }],
          },
        ],
      }),
  });
  expect(await provider.search("Synthetic")).toEqual([
    {
      id: "seed",
      name: "Synthetic Artist",
      type: "urn:entity:artist",
      description: "A synthetic contract example.",
    },
  ]);
});

test("native nested locations and descriptions preserve ranking while closed places are filtered", async () => {
  const provider = createQlooProvider({
    apiKey: "test-only",
    fetch: async () =>
      Response.json({
        success: true,
        results: {
          entities: [
            {
              entity_id: "closed",
              name: "Closed synthetic",
              location: { lat: 38.72, lon: -9.13 },
              properties: { is_closed: true },
              tags: [{ id: "urn:tag:category:place:museum" }],
            },
            {
              entity_id: "open",
              name: "Open synthetic",
              location: { lat: 38.72, lon: -9.13 },
              properties: { short_description: "Synthetic venue, never live output." },
              tags: [{ id: "urn:tag:category:place:museum" }],
              query: { affinity: 0 },
            },
          ],
        },
      }),
  });
  const result = await provider.recommend({ entityIds: ["seed"], lat: 38.7223, lng: -9.1393 });
  expect(result.places).toHaveLength(1);
  expect(result.places[0]).toMatchObject({
    id: "open",
    lat: 38.72,
    lng: -9.13,
    taste: { rank: 2, score: 0 },
    description: "Synthetic venue, never live output.",
  });
});
