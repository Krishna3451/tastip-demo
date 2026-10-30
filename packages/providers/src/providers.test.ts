import { describe, expect, test } from "bun:test";
import { createTripFromPlaces, DEFAULT_BRIEF } from "@tastip/domain";
import { createOpenAIProviders } from "./openai";
import { createQlooProvider, selectTasteCandidates } from "./qloo";

const seed = "22222222-2222-4222-8222-222222222222";
const query = { entityIds: [seed], lat: 38.7223, lng: -9.1393 };
const makeEntity = (suffix: number, overrides: Record<string, unknown> = {}) => ({
  entity_id: `11111111-1111-4111-8111-${String(suffix).padStart(12, "0")}`,
  name: `Synthetic test cafe ${suffix}`,
  subtype: "urn:entity:place",
  lat: 38.7223,
  lon: -9.1393,
  affinity: 0,
  is_closed: false,
  tags: [{ id: "urn:tag:genre:place:restaurant:cafe" }],
  ...overrides,
});

describe("provider configuration boundary", () => {
  test("missing keys fail honestly without making a request", async () => {
    let requested = false;
    const qloo = createQlooProvider({
      fetch: async () => {
        requested = true;
        return new Response();
      },
    });
    await expect(qloo.search("A cultural favorite")).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
    expect(requested).toBe(false);
    const openai = createOpenAIProviders({});
    await expect(openai.conversation.reply({ message: "Plan a trip" })).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
    await expect(openai.voice.createSession()).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  test("upstream failures never leak response bodies or credentials", async () => {
    const qloo = createQlooProvider({
      apiKey: "private-test-value",
      fetch: async () => new Response("upstream-debug-private-test-value", { status: 401 }),
    });
    try {
      await qloo.recommend(query);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(String(error)).not.toContain("private-test-value");
    }
  });
});

describe("Qloo native contract", () => {
  test("uses the event host, native parameters and metres; retains rank and zero affinity", async () => {
    let capturedUrl = "";
    let capturedKey = "";
    const qloo = createQlooProvider({
      apiKey: "test-key",
      fetch: async (input, init) => {
        capturedUrl = String(input);
        capturedKey = new Headers(init?.headers).get("X-Api-Key") || "";
        return Response.json({ success: true, results: { entities: [makeEntity(1)] } });
      },
    });
    const result = await qloo.recommend(query);
    const url = new URL(capturedUrl);
    expect(url.origin).toBe("https://hackathon.api.qloo.com");
    expect(url.pathname).toBe("/v2/insights");
    expect(url.searchParams.get("filter.location")).toBe("POINT(-9.1393 38.7223)");
    expect(url.searchParams.get("filter.location.radius")).toBe("8000");
    expect(url.searchParams.get("filter.type")).toBe("urn:entity:place");
    expect(url.searchParams.get("signal.interests.entities")).toBe(seed);
    expect(url.searchParams.has("feature.explainability")).toBe(false);
    expect(url.searchParams.get("sort_by")).toBe("affinity");
    expect(capturedKey).toBe("test-key");
    expect(result.places[0]?.taste).toEqual({ queryId: result.queryId, rank: 1, score: 0 });
    expect(result.places[0]?.practical).toEqual({ hours: "unknown", cost: "unknown" });
  });

  test("closed, missing and out-of-bounds results cannot become eligible stops", async () => {
    const qloo = createQlooProvider({
      apiKey: "test-key",
      fetch: async () =>
        Response.json({
          success: true,
          results: {
            entities: [
              makeEntity(1, { is_closed: true }),
              makeEntity(2, { lat: null }),
              makeEntity(3, { lat: 0, lon: 0 }),
              makeEntity(4),
            ],
          },
        }),
    });
    const result = await qloo.recommend(query);
    expect(result.places.map((place) => place.name)).toEqual(["Synthetic test cafe 4"]);
    expect(result.places[0]?.taste?.rank).toBe(4);
    expect(result.warnings).toHaveLength(3);
  });

  test("malformed provider data rejects instead of pretending an empty success", async () => {
    const qloo = createQlooProvider({
      apiKey: "test-key",
      fetch: async () => Response.json({ results: { entities: [{ name: "No identity" }] } }),
    });
    await expect(qloo.recommend(query)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });

  test("documented flat place shape normalizes without relying on attribute tags", async () => {
    // Shape from https://docs.qloo.com/reference/schema-taxonomy (Places). Values
    // are invented test data, not an authenticated or copied Qloo response.
    const park = makeEntity(1, {
      name: "Synthetic riverside park",
      type: "urn:entity",
      description: "A synthetic outdoor place for contract testing.",
      address: "1 Example Walk",
      city: "Example city",
      country: "Example country",
      country_code: "XX",
      business_rating: 4.5,
      popularity: 0.8,
      tags: [
        { id: "urn:tag:amenity:place:slides", name: "Slides", type: "urn:tag:amenity:place" },
        { id: "urn:tag:category:place:park", name: "Park", type: "urn:tag:category:place" },
      ],
    });
    const hotel = makeEntity(2, {
      tags: [
        { id: "urn:tag:genre:place:hotel" },
        { id: "urn:tag:amenity:place:garden" },
        { id: "urn:tag:decor:qloo:historic" },
      ],
    });
    const qloo = createQlooProvider({
      apiKey: "test-key",
      fetch: async () => Response.json({ success: true, results: { entities: [park, hotel] } }),
    });
    const result = await qloo.recommend(query);
    expect(result.places).toHaveLength(1);
    expect(result.places[0]?.category).toBe("outdoors");
    expect(result.warnings).toHaveLength(1);
    expect(result.lodgings).toHaveLength(1);
  });

  test("search no-results is empty and legacy seed types are neither requested nor accepted", async () => {
    const empty = createQlooProvider({
      apiKey: "test-key",
      fetch: async () => new Response(null, { status: 404 }),
    });
    expect(await empty.search("No matching favorite")).toEqual([]);
    let url: URL | undefined;
    const search = createQlooProvider({
      apiKey: "test-key",
      fetch: async (input) => {
        url = new URL(String(input));
        return Response.json({
          success: true,
          results: [
            makeEntity(1, { subtype: "urn:entity:artist" }),
            makeEntity(2, { subtype: "urn:entity:album" }),
          ],
        });
      },
    });
    expect((await search.search("An artist")).map((entity) => entity.type)).toEqual([
      "urn:entity:artist",
    ]);
    expect(url?.searchParams.get("types")).toContain("urn:entity:movie");
    expect(url?.searchParams.get("types")).not.toContain("urn:entity:album");
  });

  test("native query affinity and unavailable explainability remain honest", async () => {
    const entity = makeEntity(1, { affinity: undefined, query: { affinity: 0 } });
    const qloo = createQlooProvider({
      apiKey: "test-key",
      fetch: async () =>
        Response.json({
          success: true,
          results: { entities: [entity] },
          query: { explainability: { warning: "No contributions available" } },
        }),
    });
    const result = await qloo.recommend(query);
    expect(result.places[0]?.taste?.score).toBe(0);
    expect(result.warnings).toContain("Qloo explainability: No contributions available");
  });

  test("Qloo returned rank changes actual scheduled selection over the same inventory", async () => {
    const qloo = createQlooProvider({
      apiKey: "test-key",
      fetch: async () =>
        Response.json({
          success: true,
          results: { entities: [makeEntity(1), makeEntity(2), makeEntity(3), makeEntity(4)] },
        }),
    });
    const { places } = await qloo.recommend(query);
    const brief = { ...DEFAULT_BRIEF, days: 1, pace: "slow" as const };
    const first = createTripFromPlaces(brief, places);
    const changedRanks = places.map((place) => ({
      ...place,
      taste: { ...place.taste!, rank: 5 - place.taste!.rank },
    }));
    const second = createTripFromPlaces(brief, changedRanks);
    expect(first.stops[0]?.placeId).not.toBe(second.stops[0]?.placeId);
    expect(selectTasteCandidates(places, 1)[0]?.id).toBe(first.stops[0]?.placeId);
  });
});
