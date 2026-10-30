import {
  DESTINATIONS,
  type Destination,
  refineTastePlaces,
  validDestination,
} from "@tastip/domain";
import { selectTasteCandidates } from "@tastip/providers";
import { z } from "zod";
import { assertProviderAccess } from "@/server/account-http";
import { json, RequestError, readJson, routeError } from "@/server/http";
import { getProviders } from "@/server/providers";

export const runtime = "nodejs";
const schema = z.object({
  entityIds: z.array(z.string().uuid()).min(1).max(20),
  destinationId: z.string().max(100),
  destination: z.custom<Destination>(validDestination).optional(),
  includeLodging: z.boolean().optional(),
  radiusMetres: z.number().int().min(500).max(50_000).optional(),
  take: z.number().int().min(1).max(50).optional(),
  categories: z
    .array(z.enum(["cafe", "culture", "food", "outdoors", "shop"]))
    .max(5)
    .optional(),
  excludedIds: z.array(z.string().max(100)).max(150).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await readJson(request, schema);
    assertProviderAccess(request);
    const destination =
      body.destination?.id === body.destinationId
        ? body.destination
        : DESTINATIONS.find((item) => item.id === body.destinationId);
    if (!destination)
      throw new RequestError("INVALID_DESTINATION", "Choose one of the supported destinations.");
    const result = await getProviders().taste.recommend(
      {
        entityIds: body.entityIds,
        lat: destination.lat,
        lng: destination.lng,
        ...(body.radiusMetres !== undefined ? { radiusMetres: body.radiusMetres } : {}),
        ...(body.take !== undefined
          ? { take: body.take }
          : body.includeLodging
            ? { take: 50 }
            : {}),
      },
      request.signal,
    );
    return json({
      ...result,
      lodgings: result.lodgings?.map((place) => ({ ...place, destinationId: destination.id })),
      places: result.places.map((place) => ({ ...place, destinationId: destination.id })),
      selected: refineTastePlaces(
        selectTasteCandidates(result.places, result.places.length).map((place) => ({
          ...place,
          destinationId: destination.id,
        })),
        body.categories ?? [],
        body.excludedIds ?? [],
      ),
    });
  } catch (error) {
    return routeError(error);
  }
}
