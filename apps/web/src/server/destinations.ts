import { type Destination, validDestination } from "@tastip/domain";
import { z } from "zod";
import { RequestError } from "./http";

const resultSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        country: z.string().optional(),
        admin1: z.string().optional(),
        latitude: z.number(),
        longitude: z.number(),
        timezone: z.string().optional(),
      }),
    )
    .max(10)
    .optional(),
});

/** Public Open-Meteo geocoder; no user identity, trip or taste profile is sent. */
export async function findDestinations(
  query: string,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<Destination[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "6");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const response = await transport(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new RequestError(
      "GEOCODING_UNAVAILABLE",
      "City search is temporarily unavailable. Choose a featured destination or try again.",
      503,
    );
  const parsed = resultSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new RequestError(
      "GEOCODING_UNAVAILABLE",
      "City search returned incomplete data. Try another city.",
      503,
    );
  return (parsed.data.results ?? []).flatMap((city) => {
    const destination = {
      id: `geonames-${city.id}`,
      name: city.name,
      country: [city.admin1, city.country].filter(Boolean).join(", "),
      lat: city.latitude,
      lng: city.longitude,
      timeZone: city.timezone ?? "",
    };
    return validDestination(destination) ? [destination] : [];
  });
}
