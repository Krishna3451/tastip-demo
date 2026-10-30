import { expect, test } from "bun:test";
import { findDestinations } from "./destinations";

test("city geocoder retains canonical metadata and drops missing or invalid timezones", async () => {
  const fetcher = (async (url: URL | RequestInfo) => {
    expect(String(url)).toContain("name=Paris");
    return Response.json({
      results: [
        {
          id: 1,
          name: "Paris",
          country: "France",
          latitude: 48.85,
          longitude: 2.35,
          timezone: "Europe/Paris",
        },
        { id: 2, name: "Incomplete", latitude: 0, longitude: 0 },
      ],
    });
  }) as typeof fetch;
  expect(await findDestinations("Paris", undefined, fetcher)).toEqual([
    {
      id: "geonames-1",
      name: "Paris",
      country: "France",
      lat: 48.85,
      lng: 2.35,
      timeZone: "Europe/Paris",
    },
  ]);
});
