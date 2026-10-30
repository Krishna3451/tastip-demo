import { expect, test } from "bun:test";
import { getDrivingRoute } from "./routing";

test("road route preserves provider geometry and legs; missing routes never become invented durations", async () => {
  const transport = async (url: URL | RequestInfo) => {
    expect(String(url)).toContain("/route/v1/driving/");
    expect(String(url)).toContain("geometries=geojson");
    return Response.json({
      code: "Ok",
      routes: [
        {
          distance: 1500,
          duration: 250,
          legs: [{ distance: 1500, duration: 250 }],
          geometry: {
            type: "LineString",
            coordinates: [
              [-9.13, 38.72],
              [-9.14, 38.73],
            ],
          },
        },
      ],
    });
  };
  const result = await getDrivingRoute(
    [
      [-9.13, 38.72],
      [-9.14, 38.73],
    ],
    undefined,
    transport,
  );
  expect(result.profile).toBe("driving");
  expect(result.durationSeconds).toBe(250);
  expect(result.legs[0]?.distanceMetres).toBe(1500);
  expect(result.geometry).toEqual([
    [-9.13, 38.72],
    [-9.14, 38.73],
  ]);
  await expect(
    getDrivingRoute(
      [
        [-9, 38],
        [-8, 39],
      ],
      undefined,
      async () => Response.json({ code: "NoRoute", routes: [] }),
    ),
  ).rejects.toThrow("No complete driving route");
});
