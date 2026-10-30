import { type DrivingRoute, getDrivingRoute } from "@tastip/providers";
import { z } from "zod";
import { assertProviderAccess } from "@/server/account-http";
import { json, readJson, routeError } from "@/server/http";
export const runtime = "nodejs";
const cache = new Map<string, DrivingRoute>();
export async function POST(request: Request) {
  try {
    const body = await readJson(
      request,
      z.object({
        coordinates: z
          .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
          .min(2)
          .max(15),
      }),
    );
    assertProviderAccess(request);
    const key = JSON.stringify(body.coordinates);
    const cached = cache.get(key);
    if (cached && Date.now() - Date.parse(cached.retrievedAt) < 300000) return json(cached);
    const route = await getDrivingRoute(body.coordinates, request.signal);
    if (cache.size >= 50) cache.delete(cache.keys().next().value as string);
    cache.set(key, route);
    return json(route);
  } catch (error) {
    return routeError(error);
  }
}
