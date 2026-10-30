import { z } from "zod";
import { ProviderError } from "./contracts";
export type DrivingRoute = {
  source: "osrm";
  profile: "driving";
  retrievedAt: string;
  distanceMetres: number;
  durationSeconds: number;
  legs: { distanceMetres: number; durationSeconds: number }[];
  geometry: [number, number][];
};
const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const schema = z.object({
  code: z.literal("Ok"),
  routes: z
    .array(
      z.object({
        distance: z.number().nonnegative(),
        duration: z.number().nonnegative(),
        legs: z
          .array(
            z.object({ distance: z.number().nonnegative(), duration: z.number().nonnegative() }),
          )
          .max(14),
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(coordinate).min(2).max(20000),
        }),
      }),
    )
    .min(1),
});
export async function getDrivingRoute(
  points: [number, number][],
  signal?: AbortSignal,
  transport: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): Promise<DrivingRoute> {
  if (!z.array(coordinate).min(2).max(15).safeParse(points).success)
    throw new ProviderError(
      "INVALID_TASTE_QUERY",
      "Choose between 2 and 15 real place coordinates for a day route.",
    );
  const url = new URL(
    `https://router.project-osrm.org/route/v1/driving/${points.map((point) => point.join(",")).join(";")}`,
  );
  url.search = new URLSearchParams({
    overview: "simplified",
    geometries: "geojson",
    steps: "false",
  }).toString();
  const response = await transport(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
    headers: {
      Accept: "application/json",
      "User-Agent": "Tastip/0.1 (+https://github.com/Tastip/tastip)",
    },
  });
  if (!response.ok)
    throw new ProviderError(
      "PROVIDER_UNAVAILABLE",
      "Driving directions are temporarily unavailable. No travel times have been assumed.",
    );
  const parsed = schema.safeParse(await response.json());
  const route = parsed.success ? parsed.data.routes[0] : undefined;
  if (!route || route.legs.length !== points.length - 1)
    throw new ProviderError(
      "INVALID_PROVIDER_RESPONSE",
      "No complete driving route was returned for these places. Check directions directly.",
    );
  return {
    source: "osrm",
    profile: "driving",
    retrievedAt: new Date().toISOString(),
    distanceMetres: route.distance,
    durationSeconds: route.duration,
    legs: route.legs.map((leg) => ({
      distanceMetres: leg.distance,
      durationSeconds: leg.duration,
    })),
    geometry: route.geometry.coordinates,
  };
}
