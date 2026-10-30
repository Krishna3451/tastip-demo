import type { LodgingCandidate, Place } from "@tastip/domain";
import { z } from "zod";
import { ProviderError, type TasteProvider, type TasteQuery } from "./contracts";
import { normalizePlaceFacts } from "./place-facts";

// Event credentials belong to the hackathon host, not the production API host.
const QLOO_BASE_URL = "https://hackathon.api.qloo.com";
function plainText(value: string | null | undefined): string | null {
  return value
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
    : null;
}
const SUPPORTED_SEED_TYPES = [
  "artist",
  "book",
  "brand",
  "movie",
  "person",
  "place",
  "podcast",
  "tv_show",
  "videogame",
].map((type) => `urn:entity:${type}`);
const entitySchema = z.object({
  entity_id: z.string().min(1),
  name: z.string().min(1),
  disambiguation: z.string().nullable().optional(),
  subtype: z.string().optional(),
  types: z.array(z.string()).optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
    .nullable()
    .optional(),
  properties: z
    .object({
      short_description: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      is_closed: z.boolean().nullable().optional(),
      hours: z.unknown().optional(),
      address: z.unknown().optional(),
      phone: z.unknown().optional(),
      website: z.unknown().optional(),
      menu_url: z.unknown().optional(),
      specialty_dishes: z.unknown().optional(),
      cuisine_description: z.unknown().optional(),
      images: z.unknown().optional(),
      image: z.unknown().optional(),
    })
    .optional(),
  short_description: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  affinity: z.number().min(0).max(1).optional(),
  query: z.object({ affinity: z.number().min(0).max(1).optional() }).optional(),
  is_closed: z.boolean().optional(),
  tags: z
    .array(z.object({ id: z.string(), name: z.string().nullable().optional() }))
    .nullable()
    .optional(),
});

function categoryFromTags(tags: { id: string }[] | null | undefined): Place["category"] | null {
  // Category/genre tags classify a place. Amenities and decor do not: a hotel with
  // a garden or historic wallpaper must not become a park or museum.
  const ids =
    tags
      ?.map((tag) => tag.id.toLowerCase())
      .filter((id) => /^urn:tag:(genre|category):place:/.test(id))
      .join(" ") || "";
  if (/cafe|coffee/.test(ids)) return "cafe";
  if (/restaurant|dining|bakery|food/.test(ids)) return "food";
  if (/museum|gallery|art_centre|theater|theatre|historical_landmark|castle/.test(ids))
    return "culture";
  if (/park|garden|beach|hiking|outdoor/.test(ids)) return "outdoors";
  if (/bookstore|bookshop|shopping|store|shop/.test(ids)) return "shop";
  return null;
}

function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function selectTasteCandidates(places: Place[], limit: number): Place[] {
  // The Qloo rank affects selection directly. Never combine scores from separate queries.
  return places
    .filter((place) => place.source === "qloo" && place.taste)
    .sort((a, b) => (a.taste?.rank ?? Infinity) - (b.taste?.rank ?? Infinity))
    .slice(0, limit);
}

export function createQlooProvider(config: {
  apiKey?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}): TasteProvider {
  const request = config.fetch || fetch;

  async function get(
    path: string,
    params: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!config.apiKey) {
      throw new ProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "Qloo is not connected yet. Sample places are not Qloo recommendations.",
      );
    }
    let response: Response;
    try {
      response = await request(`${QLOO_BASE_URL}${path}?${params}`, {
        headers: { "X-Api-Key": config.apiKey, Accept: "application/json" },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch {
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "Qloo could not be reached. Please try again.",
      );
    }
    if (!response.ok) {
      // The Search contract uses 404 for an ordinary no-results outcome.
      if (response.status === 404 && path === "/search") return { success: true, results: [] };
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "Qloo could not complete this request. Please try again.",
      );
    }
    try {
      return await response.json();
    } catch {
      throw new ProviderError("INVALID_PROVIDER_RESPONSE", "Qloo returned an unreadable response.");
    }
  }

  return {
    async search(query, signal) {
      const params = new URLSearchParams({
        query,
        take: "8",
        types: SUPPORTED_SEED_TYPES.join(","),
      });
      const body = await get("/search", params, signal);
      const parsed = z
        .object({
          success: z.literal(true).optional(),
          results: z.array(entitySchema.omit({ tags: true })),
        })
        .safeParse(body);
      if (!parsed.success)
        throw new ProviderError(
          "INVALID_PROVIDER_RESPONSE",
          "Qloo returned an unexpected search result.",
        );
      return parsed.data.results.flatMap((entity) => {
        const type = [entity.subtype, ...(entity.types ?? [])].find(
          (value) => value && SUPPORTED_SEED_TYPES.includes(value),
        );
        return type
          ? [
              {
                id: entity.entity_id,
                name: entity.name,
                type,
                description: plainText(
                  entity.properties?.short_description ||
                    entity.short_description ||
                    entity.properties?.description ||
                    entity.description ||
                    entity.disambiguation ||
                    null,
                ),
              },
            ]
          : [];
      });
    },
    async recommend(query: TasteQuery, signal) {
      if (
        !query.entityIds.length ||
        query.entityIds.length > 20 ||
        !Number.isFinite(query.lat) ||
        Math.abs(query.lat) > 90 ||
        !Number.isFinite(query.lng) ||
        Math.abs(query.lng) > 180 ||
        (query.radiusMetres !== undefined &&
          (!Number.isInteger(query.radiusMetres) ||
            query.radiusMetres < 500 ||
            query.radiusMetres > 50_000)) ||
        (query.take !== undefined &&
          (!Number.isInteger(query.take) || query.take < 1 || query.take > 50))
      ) {
        throw new ProviderError(
          "INVALID_TASTE_QUERY",
          "Choose at least one confirmed cultural favorite and a valid destination.",
        );
      }
      const queryId = crypto.randomUUID();
      const params = new URLSearchParams({
        "filter.type": "urn:entity:place",
        "signal.interests.entities": query.entityIds.join(","),
        "filter.location": `POINT(${query.lng} ${query.lat})`,
        "filter.location.radius": String(query.radiusMetres ?? 8000),
        // Enable explainability only once its contributor evidence is normalized
        // and presented. Ranked selection and query identity already remain native.
        sort_by: "affinity",
        take: String(query.take ?? 20),
      });
      const body = await get("/v2/insights", params, signal);
      const parsed = z
        .object({
          success: z.literal(true),
          results: z.object({ entities: z.array(entitySchema) }),
          query: z
            .object({
              explainability: z.object({ warning: z.string().max(2000).optional() }).optional(),
            })
            .optional(),
        })
        .safeParse(body);
      if (!parsed.success)
        throw new ProviderError(
          "INVALID_PROVIDER_RESPONSE",
          "Qloo returned an unexpected recommendation result.",
        );
      const warnings: string[] = [];
      const explanationWarning = parsed.data.query?.explainability?.warning;
      if (explanationWarning) warnings.push(`Qloo explainability: ${explanationWarning}`);
      const places: Place[] = [];
      const lodgings: Omit<LodgingCandidate, "destinationId">[] = [];
      const retrievedAt = new Date().toISOString();
      const seen = new Set<string>();
      parsed.data.results.entities.forEach((entity, index) => {
        const category = categoryFromTags(entity.tags);
        const isLodging = entity.tags?.some((tag) =>
          /^urn:tag:(genre|category):place:(?:hotel|hostel|lodging|bed_and_breakfast)(?::|$)/i.test(
            tag.id,
          ),
        );
        const lat = entity.location?.lat ?? entity.lat;
        const lon = entity.location?.lon ?? entity.lon;
        if (
          isLodging &&
          !entity.is_closed &&
          !entity.properties?.is_closed &&
          lat !== null &&
          lat !== undefined &&
          lon !== null &&
          lon !== undefined &&
          distanceMetres(query.lat, query.lng, lat, lon) <= (query.radiusMetres ?? 8000)
        ) {
          const facts = normalizePlaceFacts(entity.properties, retrievedAt);
          lodgings.push({
            id: entity.entity_id,
            name: entity.name,
            description:
              plainText(
                entity.properties?.short_description ||
                  entity.properties?.description ||
                  entity.description,
              ) ?? "Qloo lodging suggestion; confirm all details with the property.",
            lat,
            lng: lon,
            source: "qloo",
            taste: { queryId, rank: index + 1 },
            ...(facts ? { facts } : {}),
          });
        }
        if (isLodging) {
          warnings.push(`Result ${index + 1} is lodging and is kept separate from timed visits.`);
          return;
        }
        if (
          entity.is_closed ||
          entity.properties?.is_closed ||
          lat == null ||
          lon == null ||
          !category ||
          seen.has(entity.entity_id)
        ) {
          warnings.push(
            `Result ${index + 1} was excluded: closed, duplicate, or missing supported location/category data.`,
          );
          return;
        }
        if (distanceMetres(query.lat, query.lng, lat, lon) > (query.radiusMetres ?? 8000)) {
          warnings.push(
            `Result ${index + 1} was excluded: outside the requested destination radius.`,
          );
          return;
        }
        seen.add(entity.entity_id);
        const facts = normalizePlaceFacts(entity.properties, retrievedAt);
        places.push({
          id: entity.entity_id,
          name: entity.name,
          category,
          description:
            entity.properties?.short_description ||
            entity.properties?.description ||
            entity.short_description ||
            entity.description ||
            "Qloo recommendation; practical details still need verification.",
          lat,
          lng: lon,
          source: "qloo",
          taste: {
            queryId,
            rank: index + 1,
            ...((entity.query?.affinity ?? entity.affinity) === undefined
              ? {}
              : { score: entity.query?.affinity ?? entity.affinity }),
          },
          practical: { hours: "unknown", cost: "unknown" },
          ...(facts ? { facts } : {}),
        });
      });
      return {
        queryId,
        provider: "qloo",
        retrievedAt,
        lodgings,
        places,
        warnings,
      };
    },
  };
}
